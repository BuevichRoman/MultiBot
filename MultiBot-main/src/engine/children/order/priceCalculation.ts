/**
 * Подстановка переменных в формулу цены и вычисление (children / подтверждение заказа).
 */
import type { PriceCalculationParams } from '../../types/OrderPrice';
import { getTaggedLogger } from '../../../addons/logger';

const priceLog = getTaggedLogger('order-price');

export function calculatePrice(
    formula: string,
    params: PriceCalculationParams = {},
    _calculationType: string = 'full',
): string {
    try {
        let evaluatedFormula = formula;
        for (const [key, value] of Object.entries(params)) {
            if (value != null) {
                evaluatedFormula = evaluatedFormula.replace(
                    new RegExp(key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'),
                    String(value ?? 0),
                );
            }
        }
        const result = eval(evaluatedFormula);
        if (typeof result !== 'number' || isNaN(result)) {
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
