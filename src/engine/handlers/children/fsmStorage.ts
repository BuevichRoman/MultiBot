/**
 * Структура FSM-данных children tenant (Redis).
 *
 * - **user** — профиль с API + служебные поля для бота. Язык интерфейса: `user.lang` (api id строки, напр. "1").
 * - **registration** — черновик регистрации; очищается после успешного ответа API (register / восстановление).
 * - **order** — текущий заказ:
 *   - **order.input** — ввод пользователя: координаты, часы, дети, доп. опции, when, driversMap, preferredDriversList, …
 *   - **order.calculated** — расчёты бота (цена, формула) перед/после подтверждения.
 * - **data** — устаревший плоский слой и черновики настроек; постепенно сводим к нулю. Новый код читает через {@link getOrderInputSlice}.
 * - **order** / **orderDraft** / корневые копии полей заказа — поддерживаются в чтении для обратной совместимости.
 */
export const FSM_DOC = 'children FSM: user | registration | order.input | order.calculated';

/** Путь в FSM для поля save из схемы (совпадает с ActionExecutor.handleSave). */
export function fsmPathFromSaveType(type: string | undefined, name: string): string {
    if (type === 'registration') return `registration.${name}`;
    if (type === 'order') return `order.input.${name}`;
    return `data.${name}`;
}

/** Срез полей заказа: приоритет order.input, затем legacy data.* и корень. */
export function getOrderInputSlice(root: Record<string, any> | null | undefined): Record<string, any> {
    if (!root || typeof root !== 'object') return {};
    const fromOrder = root.order?.input && typeof root.order.input === 'object' ? root.order.input : {};
    const fromData = root.data && typeof root.data === 'object' ? root.data : {};
    const legacyTop: Record<string, any> = {};
    for (const k of ORDER_INPUT_KEYS) {
        if (root[k] !== undefined && fromOrder[k] === undefined && fromData[k] === undefined) {
            legacyTop[k] = root[k];
        }
    }
    return { ...fromData, ...legacyTop, ...fromOrder };
}

const ORDER_INPUT_KEYS = [
    'latitude',
    'longitude',
    'when',
    'hoursCount',
    'childrenCount',
    'childrenInfo',
    'additionalOptions',
    'preferredDriversList',
    'driversMap',
    'cancelReasonFromState',
    'waitingForDrivers',
    'driverSelectionErrorMessage',
] as const;

/** Черновик регистрации: приоритет registration.*, fallback data.* / корень. */
export function getRegistrationSlice(root: Record<string, any> | null | undefined): Record<string, any> {
    if (!root || typeof root !== 'object') return {};
    const reg = root.registration && typeof root.registration === 'object' ? root.registration : {};
    const fromData = root.data && typeof root.data === 'object' ? root.data : {};
    return { ...fromData, ...reg };
}
