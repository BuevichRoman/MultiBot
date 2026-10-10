/**
 * Расчёт цены и форматирование сообщения подтверждения заказа для children tenant.
 * Детям запрашивается только точка старта (from = to), маршрут не вычисляется.
 */
import type { Location } from '../../types/Location';
import type { PriceModel } from '../../types/OrderPrice';
import { formatPriceFormula } from './priceCalculation';
import { formatString } from '../../utils/formatString';
import { getTaggedLogger } from '../../../addons/logger';
import { orderTimeZone } from './orderTimeZone';
import { captureError } from '../../../addons/monitoring';

const orderConfirmLog = getTaggedLogger('orderConfirmation');

function makeCurrencySymbol(price: string, currency: string): string {
    if (currency === 'EUR') return '€' + price;
    return price + ' ' + currency;
}

/** Время заказа так, как его ввёл пользователь: в поясе места заказа. */
function formatDateHuman(date: Date | null, nowLabel: string, timeZone: string): string {
    if (date === null) return nowLabel;
    return date.toLocaleDateString('en-GB', { month: 'numeric', day: 'numeric', timeZone }) +
        ' ' + date.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone });
}

const NO_PRICE: PriceModel = { formula: '-', price: '0', options: {}, calculationType: 'incomplete' };

/** Ответ шаблона nanny_pricing → PriceModel; при любой ошибке — «цены нет» */
async function askPricing(apiManager: any, payload: Record<string, any>, idField?: Record<string, string>): Promise<PriceModel> {
    if (!apiManager?.pricingTemplate) return NO_PRICE;
    try {
        const r = await apiManager.pricingTemplate(payload, idField);
        const d = r?.data?.status === 'success' ? r.data.data : null;
        if (!d?.formula) {
            orderConfirmLog.warn('pricing template answered without price', { action: payload.action, message: r?.data?.message });
            return NO_PRICE;
        }
        return { formula: d.formula, price: String(d.price), options: d.options ?? {}, calculationType: d.calculationType };
    } catch (error) {
        orderConfirmLog.error('pricing template failed', { action: payload.action, error });
        captureError(error, { scope: `pricing-template:${payload.action}` });
        return NO_PRICE;
    }
}

/**
 * Цена до создания заказа. Считает сервер (шаблон nanny_pricing, action quote):
 * формула и константы, цены опций, день/ночь по часу начала в поясе заказа.
 * Детям запрашивается только точка старта — distance/duration на сервере нули.
 */
export async function calculateOrderPriceChildren(
    apiManager: any,
    from: Location,
    additionalOptions: number[],
    when: Date | null = null,
): Promise<PriceModel> {
    return askPricing(apiManager, {
        action: 'quote',
        when: when ? when.toISOString() : null,
        time_zone: orderTimeZone(from.latitude, from.longitude),
        options: additionalOptions,
    });
}

/** Итоговая цена завершённого заказа: длительность от начала до завершения, считает сервер */
export async function finalOrderPriceChildren(
    apiManager: any,
    orderId: string | number,
    idField?: Record<string, string>,
): Promise<PriceModel> {
    return askPricing(apiManager, { action: 'final', b_id: Number(orderId) }, idField);
}

export async function formatOrderConfirmationChildren(
    apiManager: any,
    user: any,
    fsmData: Record<string, any>,
    priceModel: PriceModel,
    langId: string,
    isTestMode: boolean,
): Promise<string> {
    const dm = apiManager?.api_data_manager;
    if (!dm) return '';

    const templateKey = isTestMode ? 'wab_collectionorderconfirmtestmode' : 'wab_collectionorderconfirm';
    let template = '';
    try {
        template = (await dm.getLangValueItem?.(templateKey, langId)) || '';
    } catch {
        template = '';
    }

    const langVls = dm.data?.data?.lang_vls ?? {};
    const nowItem = langVls['wab_now'] ?? langVls['wab_nowlower'];
    const nowLabel = (nowItem?.[String(langId)] ?? '') || 'now';
    const anyClassItem = langVls['wab_anyclass'];
    const anyClassLabel = (anyClassItem?.[String(langId)] ?? '') || '-';
    const defaultCurrency = dm.data?.data?.default_currency || 'EUR';
    const bookingComments = dm.data?.data?.booking_comments || {};
    const langIso = user?.settings?.lang?.iso || 'en';

    const from = fsmData?.latitude && fsmData?.longitude
        ? `${fsmData.latitude} ${fsmData.longitude}`
        : '-';
    const to = from; // children: pickup only
    const when = fsmData?.when
        ? formatDateHuman(fsmData.when instanceof Date ? fsmData.when : new Date(fsmData.when), nowLabel,
            orderTimeZone(fsmData.latitude, fsmData.longitude))
        : nowLabel;

    orderConfirmLog.debug('order confirmation when', { whenLabel: when, whenRaw: fsmData?.when });

    const additionalOptions = fsmData?.additionalOptions || [];
    const optionsText = additionalOptions.length > 0
        ? additionalOptions
            .map((i: number) => {
                const c = bookingComments[String(i)];
                const name = c?.[apiManager.api_data_manager.data.data.langs[langId].iso] || c?.['1'] || '';
                const price = c?.options?.price ?? 0;
                return `_${name} ( ${price}${defaultCurrency} )_`;
            })
            .join('\n')
        : '';

    const priceStr = priceModel.price === '0'
        ? '-'
        : makeCurrencySymbol(
            priceModel.price + (priceModel.calculationType === 'incomplete' ? ' + ?' : ''),
            defaultCurrency
        );

    const hasCoords = !!(fsmData?.latitude && fsmData?.longitude);
    let formulaStr = formatPriceFormula(
        priceModel.formula,
        priceModel.options,
        hasCoords ? 'full' : 'incomplete'
    );
    formulaStr = formulaStr.replace(/\*/g, '×');

    const childrenInfo = typeof fsmData?.childrenInfo === 'string'
        ? fsmData.childrenInfo
        : (fsmData?.childrenInfo || []).join('\n');

    const peoplecount = String(fsmData?.childrenCount ?? fsmData?.hoursCount ?? fsmData?.peopleCount ?? '1');

    return formatString(template, {
        from,
        to,
        peoplecount,
        when,
        options: optionsText,
        price: priceStr,
        formula: formulaStr,
        class: anyClassLabel,
        childrenInfo,
        floors: '0',
        units: '',
        weight: '',
    });
}
