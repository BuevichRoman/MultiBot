/**
 * Расчёт цены и форматирование сообщения подтверждения заказа для children tenant.
 * Детям запрашивается только точка старта (from = to), маршрут не вычисляется.
 */
import type { Location } from '../../types/Location';
import type { PriceModel, PriceCalculationParams } from '../../types/OrderPrice';
import { calculatePrice, formatPriceFormula } from './priceCalculation';
import { formatString } from '../../utils/formatString';
import { getTaggedLogger } from '../../../addons/logger';

const orderConfirmLog = getTaggedLogger('orderConfirmation');

function makeCurrencySymbol(price: string, currency: string): string {
    if (currency === 'EUR') return '€' + price;
    return price + ' ' + currency;
}

function formatDateHumanUtc(date: Date | null, nowLabel: string): string {
    if (date === null) return nowLabel;
    return date.toLocaleDateString('en-GB', { month: 'numeric', day: 'numeric',
            timeZone: 'Etc/GMT-1' }) +
        ' ' + date.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit',
            timeZone: 'Etc/GMT-1' });
}

export async function calculateOrderPriceChildren(
    apiManager: any,
    from: Location,
    to: Location,
    additionalOptions: number[],
    isVoting: boolean,
): Promise<PriceModel> {
    const dm = apiManager?.api_data_manager;
    if (!dm?.data?.data?.site_constants?.pricingModels) {
        return { formula: '-', price: '0', options: {}, calculationType: 'incomplete' };
    }

    const raw = dm.data.data.site_constants.pricingModels;
    const pricingModels = typeof raw?.value === 'string' ? JSON.parse(raw.value || '{}') : (raw?.value ?? raw ?? {});
    const models = pricingModels?.pricing_models;
    if (!models) return { formula: '-', price: '0', options: {}, calculationType: 'incomplete' };

    const priceModel = models[isVoting ? 'voting' : 'basic'];
    if (!priceModel?.model?.expression) return { formula: '-', price: '0', options: {}, calculationType: 'incomplete' };

    // Только точка старта — маршрут не вычисляется, distance/duration = 0
    const distance = 0;
    const duration = 0;
    const calculationType = 'incomplete' as const;

    const now = new Date();
    const gmtPlus1 = new Date(now.getTime() + 60 * 60 * 1000);
    const currentHour = gmtPlus1.getUTCHours();
    const isDayTime = currentHour >= 6 && currentHour < 21;
    const timeRatio = isDayTime ? priceModel.constants?.time_ratio?.day : priceModel.constants?.time_ratio?.night;

    const bookingComments = dm.data?.data?.booking_comments || {};
    const options_sum = additionalOptions.reduce((sum, opt) => {
        const c = bookingComments[String(opt)];
        return sum + (c?.options?.price ?? 0);
    }, 0);

    const params: PriceCalculationParams = {
        base_price: priceModel.constants?.base_price ?? 0,
        distance: (distance ?? 0) / 1000,
        price_per_km: priceModel.constants?.price_per_km ?? 0,
        duration: (duration ?? 0) / 60,
        price_per_minute: priceModel.constants?.price_per_minute ?? 0,
        time_ratio: timeRatio ?? 1,
        options_sum,
        submit_price: 0,
        car_class_ratio: 1,
    };

    const price = calculatePrice(priceModel.model.expression, params);
    return { formula: priceModel.model.expression, price, options: params, calculationType };
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
        ? formatDateHumanUtc(fsmData.when instanceof Date ? fsmData.when : new Date(fsmData.when), nowLabel)
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
