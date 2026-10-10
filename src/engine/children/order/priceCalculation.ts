/**
 * Подстановка переменных в формулу цены и вычисление (children / подтверждение заказа).
 */
import type { PriceCalculationParams } from '../../types/OrderPrice';
import { getTaggedLogger } from '../../../addons/logger';

const priceLog = getTaggedLogger('order-price');

/**
 * Арифметика формулы цены без eval: числа, переменные из params, + - * /,
 * унарный минус и скобки. Всё прочее — ошибка, как и неизвестная переменная.
 */
export function evaluateFormula(formula: string, params: PriceCalculationParams): number {
    const tokens = formula.match(/\d*\.?\d+(?:e[+-]?\d+)?|[A-Za-z_]\w*|[-+*/()]|\S/gi) ?? [];
    let pos = 0;
    const fail = (why: string): never => { throw new Error(`${why} at token ${pos} in "${formula}"`); };

    const factor = (): number => {
        const t = tokens[pos++];
        if (t === '-') return -factor();
        if (t === '+') return factor();
        if (t === '(') {
            const v = expr();
            if (tokens[pos++] !== ')') fail('missing )');
            return v;
        }
        if (t !== undefined && /^\d*\.?\d/.test(t)) return Number(t);
        if (t !== undefined && /^[A-Za-z_]/.test(t)) {
            const v = params[t];
            const n = typeof v === 'number' ? v : v == null || v === '' ? NaN : Number(v);
            if (!Number.isFinite(n)) fail(`unknown variable ${t}`);
            return n;
        }
        return fail(`unexpected ${t ?? 'end'}`);
    };
    const term = (): number => {
        let v = factor();
        while (tokens[pos] === '*' || tokens[pos] === '/') v = tokens[pos++] === '*' ? v * factor() : v / factor();
        return v;
    };
    const expr = (): number => {
        let v = term();
        while (tokens[pos] === '+' || tokens[pos] === '-') v = tokens[pos++] === '+' ? v + term() : v - term();
        return v;
    };

    const result = expr();
    if (pos !== tokens.length) fail('trailing input');
    return result;
}

export function calculatePrice(
    formula: string,
    params: PriceCalculationParams = {},
    _calculationType: string = 'full',
): string {
    try {
        const result = evaluateFormula(formula, params);
        if (!Number.isFinite(result)) {
            throw new Error('Invalid calculation result');
        }
        return Math.trunc(result).toString();
    } catch (error) {
        priceLog.error('Failed to calculate price', { error });
        return '0';
    }
}

export function formatPriceFormula(
    formula: string,
    params: PriceCalculationParams,
    calculationType: string = 'full',
): string {
    try {
        let formattedFormula = formula;
        const variables = [
            'base_price', 'distance', 'price_per_km', 'duration', 'price_per_minute',
            'time_ratio', 'options_sum', 'submit_price', 'car_class_ratio',
            'floors', 'weight', 'units', 'price_per_kg', 'price_per_unit', 'price_per_floor',
        ];
        const incompleteVariables = ['distance', 'duration'];

        for (const variable of variables) {
            let value = params[variable];
            if (calculationType === 'incomplete' && incompleteVariables.includes(variable)) {
                value = '?';
            } else {
                const num = typeof value === 'number' ? value : parseFloat(String(value ?? 0));
                if (variable.endsWith('ratio') && num % 1 !== 0) {
                    value = num.toFixed(2);
                } else {
                    value = Math.trunc(num);
                }
            }
            formattedFormula = formattedFormula.replace(
                new RegExp(variable.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'),
                String(value),
            );
        }
        return formattedFormula;
    } catch (error) {
        priceLog.error('Failed to format price formula', { error });
        return formula;
    }
}
