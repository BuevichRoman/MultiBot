/**
 * Типы для OrderManager.
 * Менеджер один на tenant, обслуживает все заказы тенанта.
 */

/** События статуса заказа, которые уходят в JSON-движок (onSystemEvent) */
export const ORDER_STATUS_EVENTS = {
  PROCESSING: 'order_status_processing',
  APPROVED: 'order_status_approved',
  DRIVER_ARRIVED: 'order_status_driver_arrived',
  DRIVER_STARTED: 'order_status_driver_started',
  DRIVER_CANCELED: 'order_status_driver_canceled',
  CANCELED: 'order_status_canceled',
  COMPLETED: 'order_status_completed',
  OUT_OF_TIME: 'order_status_out_of_time',
} as const;

export type OrderStatusEvent = (typeof ORDER_STATUS_EVENTS)[keyof typeof ORDER_STATUS_EVENTS];

/** Сырые данные заказа с API (формат drive/get) */
export interface RawOrderData {
  b_state: number;
  b_start_datetime?: string;
  b_max_waiting_list?: Record<string, { additional?: string; created?: string } | Record<string, unknown>>;
  drivers?: Array<{
    u_id?: string;
    c_id?: string;
    c_appointed?: string | null;
    c_arrived?: string | null;
    c_started?: string | null;
    c_canceled?: string | null;
    c_completed?: string | null;
  }>;
}

/** Один заказ в реестре наблюдения */
export interface OrderWatchEntry {
  orderId: string;
  botId: string;
  chatId: string;
  tenantId: string;
  userId?: string;
  /** idField для API: { u_a_tg } | { u_a_wa } | { chatId } */
  idField?: Record<string, string>;
  lang?: string;
  /** Макс. время ожидания в секундах (например 600 = 10 мин). По истечении — отмена и order_status_out_of_time */
  maxWaitingSecs: number;
  /** Момент постановки на наблюдение (Unix ms) */
  registeredAt: number;
  /** Интервал опроса в ms */
  pollIntervalMs: number;
  /** Последний отправленный в движок статус (чтобы не дублировать) */
  lastEmittedEvent?: OrderStatusEvent;
  /** Доп. данные (для расширений) */
  meta?: Record<string, unknown>;
}

/** Параметры при постановке заказа на наблюдение */
export interface RegisterOrderOptions {
  orderId: string;
  botId: string;
  chatId: string;
  userId?: string;
  /** idField для API: { u_a_tg } | { u_a_wa } | { chatId } */
  idField?: Record<string, string>;
  lang?: string;
  /** Макс. время ожидания в секундах (по умолчанию 600 = 10 мин) */
  maxWaitingSecs?: number;
  pollIntervalMs?: number;
  meta?: Record<string, unknown>;
}

/** Полезная нагрузка system event — передаётся в оркестратор и далее в handler как ctx */
export interface SystemEventPayload {
  tenantId: string;
  botId: string;
  chatId: string | number;
  userId?: string | number;
  /** Событие для FSM (например order_status_approved) */
  event: OrderStatusEvent | string;
  /** Доп. данные (orderId и т.д.) */
  payload?: { orderId?: string; [k: string]: unknown };
}

/** Конфиг OrderManager: откуда брать данные заказа и куда слать события */
export interface OrderManagerConfig {
  /** Получить текущие данные заказа с API. Возврат null при ошибке/заказ не найден */
  getOrderState: (orderId: string, idField?: Record<string, string>) => Promise<RawOrderData | null>;
  /** Отменить заказ по причине (например таймаут). idField для set_cancel_state */
  cancelOrder: (orderId: string, reason: string, idField?: Record<string, string>) => Promise<void>;
  /** Вызов при смене статуса — оркестратор превратит это в ctx и вызовет tenant handler */
  onSystemEvent: (payload: SystemEventPayload) => Promise<void>;
  /** Интервал опроса по умолчанию (ms) */
  defaultPollIntervalMs?: number;
}
