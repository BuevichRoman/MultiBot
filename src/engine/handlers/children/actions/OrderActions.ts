import { Action } from '../../../types';
import { calculateOrderPriceChildren, formatOrderConfirmationChildren } from '../../../children/order/orderConfirmation';
import { CANCEL_REASON_KEYS } from '../../../children/settings/settingsHelpers';
import type { ActionContext } from './types';
import { getOrderInputSlice } from '../fsmStorage';
import { getTaggedLogger, logBusinessEvent } from '../../../../addons/logger';
import { formatPriceFormula } from '../../../children/order/priceCalculation';

const orderActLog = getTaggedLogger('OrderActions');

/** Корневые и legacy data.* ключи заказа — удаляем вместе с order */
const ORDER_LEGACY_ROOT_KEYS = [
    'latitude', 'longitude', 'when', 'hoursCount', 'childrenCount',
    'childrenInfo', 'additionalOptions', 'preferredDriversList', 'driversMap',
    'waitingForDrivers', 'driverSelectionErrorMessage', 'cancelReasonFromState',
    'orderDraft', 'driversListText',
];

export async function handleClearOrderData(ctx: ActionContext): Promise<void> {
    const container = await ctx.getData();
    if (!container || typeof container !== 'object') return;
    const cleaned = { ...container };
    delete (cleaned as any).order;
    for (const key of ORDER_LEGACY_ROOT_KEYS) {
        delete (cleaned as any)[key];
    }
    if (cleaned.data && typeof cleaned.data === 'object') {
        const dataCopy = { ...cleaned.data };
        for (const key of ORDER_LEGACY_ROOT_KEYS) {
            delete (dataCopy as any)[key];
        }
        cleaned.data = Object.keys(dataCopy).length ? dataCopy : undefined;
        if (!cleaned.data) delete cleaned.data;
    }
    await ctx.setData(cleaned);
}

export async function handleStartDriverSearch(ctx: ActionContext): Promise<void> {
    const manager = ctx.orchestrator.getDriverSearchManager(ctx.tenantId);
    if (!manager) return;
    const container = await ctx.getData();
    const langId = String(container?.user?.lang ?? '1');
    const phrase = await ctx.getLocalizedText('wab_searchingForDrivers', langId);
    const messageId = await ctx.sendMessageAndGetId(phrase);
    manager.start({ chatId: ctx.chatId, botId: ctx.botId, userId: ctx.userId, messageId });
}

export async function handleSendSelectAdditionalOptions(ctx: ActionContext): Promise<void> {
    await ctx.ensureApiDataLoaded();
    const root = await ctx.getData();
    const langId = String(root?.user?.lang ?? '1');
    const dm = ctx.apiManager?.api_data_manager;
    if (!dm?.data?.data?.booking_comments) {
        const fallback = await ctx.getLocalizedText('wab_selectAdditionalOptions', langId);
        await ctx.sendMessage((fallback || 'Select options').replace(/%options%/g, '-'));
        return;
    }
    const bookingComments = dm.data.data.booking_comments as Record<string, Record<string, unknown> & { options?: { hidden?: boolean } }>;
    const langIso = ctx.apiManager.api_data_manager.data.data.langs[langId]?.iso || 'en';

    const MAX_BOOKING_COMMENT_ID = 20;

    const lines: string[] = [];
    for (const i of Object.keys(bookingComments)) {
        if (Number(i) >= MAX_BOOKING_COMMENT_ID) continue;
        const comment = bookingComments[i];
        if (comment?.options?.hidden) continue;
        const name = String(comment?.[langIso] ?? comment?.['1'] ?? comment?.['en'] ?? '');
        // Для children цена не показывается (как в старом боте)
        const pricePart = '';
        lines.push(`_*${i}*_    _${name}${pricePart}_`);
    }
    const optionsText = lines.join('\n\n') || '-';

    const template = await ctx.getLocalizedText('wab_selectAdditionalOptions', langId);
    const message = (template || 'Select options').replace(/%options%/g, optionsText);
    await ctx.sendMessage(message);
}

export async function handleSendDriverSelectionError(ctx: ActionContext): Promise<void> {
    const root = await ctx.getData();
    const slice = getOrderInputSlice(root);
    const msg = slice.driverSelectionErrorMessage;
    if (msg && typeof msg === 'string') {
        await ctx.sendMessage(msg);
    } else {
        const phrase = await ctx.getLocalizedText('wab_commandNotFound', String(root?.user?.lang ?? '1'));
        await ctx.sendMessage(phrase);
    }
}

export async function handleCreateOrder(ctx: ActionContext): Promise<void> {
    const root = await ctx.getData();
    const data = getOrderInputSlice(root);
    const lat = data.latitude;
    const lng = data.longitude;
    if (lat == null || lng == null) {
        const errPhrase = await ctx.getLocalizedText('wab_errorWhenCreatingOrder', String(root?.user?.lang ?? '1'));
        await ctx.sendMessage(errPhrase);
        return;
    }

    const from = { latitude: String(lat), longitude: String(lng) };
    const when = data.when;
    const orderDraft = {
        from,
        to: from,
        when: when instanceof Date ? when : when ? new Date(when) : null,
        hoursCount: data.hoursCount,
        childrenCount: data.childrenCount,
        additionalOptions: data.additionalOptions ?? [],
        preferredDriversList: data.preferredDriversList ?? [],
        plannedBreaks: data.plannedBreaks ?? [],
    };

    await ctx.mergeData({ orderDraft });

    if (!ctx.apiManager?.createDrive) return;

    const idField = ctx.getIdField();
    const result = await ctx.apiManager.createDrive(orderDraft, idField);

    if ('error' in result) {
        const errPhrase = await ctx.getLocalizedText('wab_errorOnOrder', '1');
        await ctx.sendMessage(errPhrase);
        return;
    }

    await ctx.mergeData({ order: { id: result.orderId } });
    const okPhrase = await ctx.getLocalizedText('wab_orderCreated', '1');
    await ctx.sendMessage(okPhrase);

    logBusinessEvent('order.created', {
        tenantId: ctx.tenantId,
        userId: String(ctx.userId),
        chatId: String(ctx.chatId),
        botId: ctx.botId,
        orderId: result.orderId,
        ...ctx.getIdField(),
    });

    if (ctx.taskManager) {
        await ctx.taskManager.enqueueTask(ctx.tenantId, {
            type: 'watch_order',
            chatId: ctx.chatId,
            botId: ctx.botId,
            userId: ctx.userId,
            orderId: result.orderId,
            idField: ctx.getIdField(),
        });
    }
}

export async function handleSetRate(ctx: ActionContext): Promise<void> {
    const data = await ctx.getData();
    const orderId = data?.order?.id ?? data?.data?.order?.id;
    const rate = data?.order?.rate ?? data?.data?.order?.rate ?? parseInt(String(ctx.input), 10);
    if (!orderId || !rate || rate < 1 || rate > 5) return;
    if (ctx.apiManager?.setRate) {
        await ctx.apiManager.setRate(String(orderId), rate, ctx.getIdField());
    }
}

export async function handleSetReview(ctx: ActionContext): Promise<void> {
    const data = await ctx.getData();
    const orderId = data?.order?.id ?? data?.data?.order?.id;
    const review = data?.order?.review ?? ctx.input?.trim();
    if (!orderId || !review) return;
    if (ctx.apiManager?.setReview) {
        await ctx.apiManager.setReview(String(orderId), review, ctx.getIdField());
    }
}

export async function handleSendOrderConfirmation(ctx: ActionContext): Promise<void> {
    await ctx.ensureApiDataLoaded();
    const container = await ctx.getData();
    const data = getOrderInputSlice(container);
    const lat = data.latitude;
    const lng = data.longitude;
    if (!lat || !lng) {
        const fallback = await ctx.getLocalizedText('wab_collectionOrderConfirm', String(container?.user?.lang ?? '1'));
        await ctx.sendMessage(fallback || 'Confirm order');
        return;
    }

    let user: any = null;
    try {
        const profileRes = await ctx.apiManager.getProfile(ctx.getIdField());
        if (profileRes?.status === 'success' && profileRes?.data?.user) {
            const keys = Object.keys(profileRes.data.user);
            user = keys.length ? profileRes.data.user[keys[0]] : null;
        }
    } catch {
        /* ignore */
    }

    const overrides = ctx.orchestrator.getTenantOverrides?.(ctx.tenantId);
    const testRefCode = overrides?.testRefCode ?? '666';
    const isTestMode = user?.referrer_u_id === testRefCode;

    const from = { latitude: parseFloat(String(lat)), longitude: parseFloat(String(lng)) };
    const to = { ...from };
    const additionalOptions = data.additionalOptions || [];
    const priceModel = await calculateOrderPriceChildren(ctx.apiManager, from, to, additionalOptions, false);

    const langId = String(container?.user?.lang ?? user?.settings?.lang?.api_id ?? '1');
    const text = await formatOrderConfirmationChildren(
        ctx.apiManager,
        user || { settings: { lang: { iso: 'en' } } },
        data,
        priceModel,
        langId,
        isTestMode
    );
    await ctx.sendMessage(text);
    await ctx.mergeData({
        order: {
            calculated: {
                price: priceModel.price,
                formula: priceModel.formula,
                calculationType: priceModel.calculationType,
            },
        },
    });
}

export async function handleSendOrderCompleted(ctx: ActionContext): Promise<void> {
    await ctx.ensureApiDataLoaded();
    const container = await ctx.getData();
    const data = getOrderInputSlice(container);
    const orderDraft = (container as any)?.orderDraft ?? data;
    const lat = data.latitude ?? orderDraft?.from?.latitude ?? orderDraft?.latitude;
    const lng = data.longitude ?? orderDraft?.from?.longitude ?? orderDraft?.longitude;
    if (!lat || !lng) {
        const template = await ctx.getLocalizedText('wab_statecompleted', String(container?.user?.lang ?? '1'));
        const fallback = (template || '').replace(/%price%/g, '-').replace(/%formula%/g, '-');
        await ctx.sendMessage(fallback || 'Заказ завершён');
        return;
    }

    const from = { latitude: parseFloat(String(lat)), longitude: parseFloat(String(lng)) };
    const to = { ...from };
    const additionalOptions = (data.additionalOptions ?? orderDraft?.additionalOptions ?? []) as number[];
    const priceModel = await calculateOrderPriceChildren(ctx.apiManager, from, to, additionalOptions, false);

    const dm = ctx.apiManager?.api_data_manager;
    const defaultCurrency = dm?.data?.data?.default_currency || 'EUR';
    const priceStr = priceModel.price === '0'
        ? '-'
        : (defaultCurrency === 'EUR' ? '€' + priceModel.price : priceModel.price + ' ' + defaultCurrency);

    let formulaStr = formatPriceFormula(priceModel.formula, priceModel.options, !!(lat && lng) ? 'full' : 'incomplete');
    formulaStr = formulaStr.replace(/\*/g, '×');

    let langId = String(container?.user?.lang ?? '1');
    try {
        const profileRes = await ctx.apiManager.getProfile(ctx.getIdField());
        if (profileRes?.status === 'success' && profileRes?.data?.user) {
            const keys = Object.keys(profileRes.data.user);
            const user = keys.length ? profileRes.data.user[keys[0]] : null;
            langId = String(user?.u_lang ?? user?.settings?.lang?.api_id ?? container?.user?.lang ?? langId);
        }
    } catch {
        /* ignore */
    }
    let template = await ctx.getLocalizedText('wab_statecompleted', String(langId));
    template = (template || '').replace(/%price%/g, priceStr).replace(/%formula%/g, formulaStr);
    await ctx.sendMessage(template);
}

export async function handleSendOrderApproved(ctx: ActionContext): Promise<void> {
    await ctx.ensureApiDataLoaded();
    const container = await ctx.getData();
    const orderId = container?.order?.id ?? container?.data?.order?.id;
    if (!orderId) return;
    const langId = String(container?.user?.lang ?? '1');
    const driverCar = await ctx.apiManager.getDriverAndCar?.(String(orderId), langId);
    const template = await ctx.getLocalizedText('wab_stateApproved', langId);
    const text = (template || '')
        .replace(/%driver%/g, driverCar?.name ?? '-')
        .replace(/%color%/g, driverCar?.color ?? '-')
        .replace(/%model%/g, driverCar?.model ?? '-')
        .replace(/%plate%/g, driverCar?.plate ?? '-');
    await ctx.sendMessage(text);
}

export async function handleSendOrderProcessing(ctx: ActionContext, actionDef: Action): Promise<void> {
    const unconditional = actionDef.params?.unconditional === true;
    if (!unconditional) {
        const container = await ctx.getData();
        const orderId = container?.order?.id ?? container?.data?.order?.id;
        if (!orderId || !ctx.apiManager?.getOrderState) return;
        try {
            const orderData = await ctx.apiManager.getOrderState(String(orderId), ctx.getIdField());
            const drivers = orderData?.drivers ?? [];
            if (drivers.length === 0) return;
        } catch {
            return;
        }
    }
    const container = await ctx.getData();
    const langId = String(container?.user?.lang ?? '1');
    const phrase = await ctx.getLocalizedText('wab_stateProcessing', String(langId));
    await ctx.sendMessage(phrase);
}

export async function handleSendCancelReasonList(ctx: ActionContext): Promise<void> {
    await ctx.ensureApiDataLoaded();
    const container = await ctx.getData();
    const langId = String(container?.user?.lang ?? '1');
    const template = await ctx.getLocalizedText('wab_collectionCancelReason', String(langId));
    const texts: Record<string, string> = {};
    for (const [, key] of Object.entries(CANCEL_REASON_KEYS)) {
        texts[key] = await ctx.getLocalizedText(key, String(langId));
    }
    const reasonContainer =
        '\n_*1*     ' + texts.mistakenly_ordered +
        '_\n_*2*     ' + texts.waiting_for_long +
        '_\n_*3*     ' + texts.conflict_with_rider +
        '_\n_*4*     ' + texts.very_expensive + '_';
    const text = (template || '').replace(/%reasons%/g, reasonContainer);
    await ctx.sendMessage(text);
}

export async function handleCancelOrderWithReason(ctx: ActionContext): Promise<void> {
    const container = await ctx.getData();
    const orderId = container?.order?.id ?? container?.data?.order?.id;
    if (!orderId) return;
        const reasonKey = CANCEL_REASON_KEYS[String(ctx.input?.trim() ?? '')];
    const reason = reasonKey
        ? await ctx.getLocalizedText(reasonKey, String(container?.user?.lang ?? '1'))
        : '';
    try {
        await ctx.apiManager.cancelOrder?.(String(orderId), reason, ctx.getIdField());
    } catch (e) {
        orderActLog.error('[handleCancelOrderWithReason] cancelOrder failed', { error: e });
    }
    const orderManager = ctx.orchestrator?.getOrderManager?.(ctx.tenantId);
    if (orderManager?.unregisterOrder) {
        orderManager.unregisterOrder(String(orderId));
    }
}

// --- перерывы (ТЗ-001) ------------------------------------------------------

/**
 * Запасные тексты перерывов.
 *
 * Тексты бота приходят из справочника lang_vls серверного конфига, и при
 * отсутствии ключа getLocalizedText возвращает сам ключ. Ключей перерывов
 * там пока нет, поэтому до их добавления показываем эти значения.
 */
const BREAK_TEXTS: Record<string, string> = {
    wab_breakstarted: 'Няня начала перерыв в %time%.',
    wab_breakended: 'Няня завершила перерыв в %time%.',
    wab_breaksummary: 'Перерывов: %count%, суммарно %breaks%. Рабочее время: %work%.',
    wab_plannedbreaksprompt:
        'Планируются ли перерывы? Укажите их в формате 11:00-12:00, ' +
        'несколько — через запятую. Отправьте 0, если перерывов не планируется.',
    wab_plannedbreakserror:
        'Не удалось разобрать интервалы. Формат: 11:00-12:00, несколько через запятую. ' +
        'Отправьте 0, если перерывов не планируется.',
};

/** Как getLocalizedText, но с запасным текстом вместо возврата самого ключа */
async function breakText(ctx: ActionContext, key: string, lang?: string): Promise<string> {
    const result = await ctx.getLocalizedText(key, lang);
    return result === key ? (BREAK_TEXTS[key] ?? key) : result;
}

/** Время в формате ЧЧ:ММ по метке сервера */
function formatBreakTime(iso?: string | null): string {
    if (!iso) return '';
    const value = new Date(iso);
    if (Number.isNaN(value.getTime())) return '';
    const hours = String(value.getHours()).padStart(2, '0');
    const minutes = String(value.getMinutes()).padStart(2, '0');
    return `${hours}:${minutes}`;
}

function formatBreakDuration(seconds?: number): string {
    const total = Math.max(0, Math.floor(seconds ?? 0));
    const hours = Math.floor(total / 3600);
    const minutes = Math.floor((total % 3600) / 60);
    if (hours > 0) return `${hours} ч ${minutes} мин`;
    if (minutes > 0) return `${minutes} мин`;
    return `${total} с`;
}

/**
 * Читает актуальное состояние заказа. Время берём с сервера, а не из
 * события — так метки остаются серверными даже если событие задержалось
 */
async function loadExecution(ctx: ActionContext) {
    const container = await ctx.getData();
    const orderId = container?.order?.id ?? container?.data?.order?.id;
    if (!orderId) return null;

    try {
        const state = await ctx.apiManager?.getOrderState?.(String(orderId));
        return {
            lang: String(container?.user?.lang ?? '1'),
            execution: state?.b_execution ?? null,
        };
    } catch (e) {
        orderActLog.error('[breaks] getOrderState failed', { orderId, error: e });
        return null;
    }
}

/** Уведомление о начале перерыва (ТЗ п. 10) */
export async function handleSendBreakStarted(ctx: ActionContext): Promise<void> {
    const loaded = await loadExecution(ctx);
    if (!loaded) return;

    const active = loaded.execution?.actual?.breaks?.find((item: any) => item.ended == null);
    const template = await breakText(ctx, 'wab_breakstarted', loaded.lang);
    await ctx.sendMessage(template.replace(/%time%/g, formatBreakTime(active?.started)));
}

/** Уведомление об окончании перерыва и текущие итоги (ТЗ п. 9, 10) */
export async function handleSendBreakEnded(ctx: ActionContext): Promise<void> {
    const loaded = await loadExecution(ctx);
    if (!loaded) return;

    const actual = loaded.execution?.actual;
    const breaks = actual?.breaks ?? [];
    const last = breaks[breaks.length - 1];

    const template = await breakText(ctx, 'wab_breakended', loaded.lang);
    await ctx.sendMessage(template.replace(/%time%/g, formatBreakTime(last?.ended)));

    // Счётчик показывает только видимые перерывы, суммы — все (ТЗ п. 20)
    const visible = breaks.filter((item: any) => item.display && item.ended != null).length;
    const summary = await breakText(ctx, 'wab_breaksummary', loaded.lang);
    await ctx.sendMessage(
        summary
            .replace(/%count%/g, String(visible))
            .replace(/%breaks%/g, formatBreakDuration(actual?.break_seconds))
            .replace(/%work%/g, formatBreakDuration(actual?.work_seconds)),
    );
}

/** Приглашение указать плановые перерывы при создании заказа (ТЗ п. 5) */
export async function handleSendPlannedBreaksPrompt(ctx: ActionContext): Promise<void> {
    const container = await ctx.getData();
    const lang = String(container?.user?.lang ?? '1');
    await ctx.sendMessage(await breakText(ctx, 'wab_plannedbreaksprompt', lang));
}

/** Сообщение о неразобранном вводе интервалов */
export async function handleSendPlannedBreaksError(ctx: ActionContext): Promise<void> {
    const container = await ctx.getData();
    const lang = String(container?.user?.lang ?? '1');
    await ctx.sendMessage(await breakText(ctx, 'wab_plannedbreakserror', lang));
}
