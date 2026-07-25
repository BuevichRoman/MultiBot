import type {
  OrderWatchEntry,
  RegisterOrderOptions,
  OrderManagerConfig,
  RawOrderData,
  OrderStatusEvent,
  SystemEventPayload,
} from './types';
import { ORDER_STATUS_EVENTS } from './types';
import { getTaggedLogger } from '../../addons/logger';

const orderMgrLog = getTaggedLogger('OrderManager');

/** Подробные логи OrderManager (tick, register, ошибки тика): `ORDER_MANAGER_LOG=1` */
function orderManagerLoggingEnabled(): boolean {
  return process.env.ORDER_MANAGER_LOG === '1';
}

/**
 * Сумма additional (секунды) из b_max_waiting_list (рекурсивно).
 */
function sumWaitingSeconds(obj: any): number {
  if (!obj || typeof obj !== 'object') return 0;
  return Object.values(obj).reduce((sum: number, item: any) => {
    if (item && typeof item === 'object') {
      const add = parseInt(item.additional, 10) || 0;
      const nested = Object.keys(item).some((k) => k !== 'additional' && k !== 'created' && typeof item[k] === 'object')
        ? sumWaitingSeconds(item)
        : 0;
      return sum + add + nested;
    }
    return sum;
  }, 0);
}

/**
 * Проверка: истекло ли время ожидания.
 * 1) Если есть data с b_start_datetime и b_max_waiting_list — как в старом боте (compareDateTimeWithWaitingList).
 * 2) Иначе — по registeredAt + maxWaitingSecs.
 */
function isOutOfTime(entry: OrderWatchEntry, data?: RawOrderData): boolean {
  if (data?.b_start_datetime && data?.b_max_waiting_list) {
    try {
      const startDate = new Date(data.b_start_datetime);
      if (!isNaN(startDate.getTime())) {
        const totalSec = sumWaitingSeconds(data.b_max_waiting_list);
        return new Date(startDate.getTime() + totalSec * 1000) < new Date();
      }
    } catch {
      /* fallback */
    }
  }
  const elapsedSec = (Date.now() - entry.registeredAt) / 1000;
  return elapsedSec >= entry.maxWaitingSecs;
}

/**
 * По сырым данным API вычислить текущий статус заказа (событие для FSM).
 * Логика из старого api/order.ts getState().
 */
function deriveEvent(data: RawOrderData): OrderStatusEvent {
  const state = Number(data.b_state);
  let driverState = -1;
  const drivers = data.drivers ?? [];
  const suitableDriver = drivers.find((d) => d.c_canceled == null);

  if (suitableDriver) {
    if (suitableDriver.c_appointed != null) driverState = 0;
    if (suitableDriver.c_arrived != null) driverState = 1;
    if (suitableDriver.c_started != null) driverState = 2;
    if (suitableDriver.c_canceled != null) driverState = 3;
    if (suitableDriver.c_completed != null) driverState = 4;
  } else if (drivers.length > 0) {
    driverState = 3;
  }

  if (state === 1 || state === 6) {
    if (driverState === 3) return ORDER_STATUS_EVENTS.DRIVER_CANCELED;
    return ORDER_STATUS_EVENTS.PROCESSING;
  }
  if (state === 2) {
    if (driverState === 0) return ORDER_STATUS_EVENTS.APPROVED;
    if (driverState === 1) return ORDER_STATUS_EVENTS.DRIVER_ARRIVED;
    if (driverState === 2) return ORDER_STATUS_EVENTS.DRIVER_STARTED;
    if (driverState === 3) return ORDER_STATUS_EVENTS.DRIVER_CANCELED;
    if (driverState === 4) return ORDER_STATUS_EVENTS.COMPLETED;
  }
  if (state === 3) return ORDER_STATUS_EVENTS.CANCELED;
  if (state === 4) return ORDER_STATUS_EVENTS.COMPLETED;

  return ORDER_STATUS_EVENTS.APPROVED;
}

const TERMINAL_EVENTS: Set<string> = new Set([
  ORDER_STATUS_EVENTS.COMPLETED,
  ORDER_STATUS_EVENTS.CANCELED,
  ORDER_STATUS_EVENTS.DRIVER_CANCELED,
  ORDER_STATUS_EVENTS.OUT_OF_TIME,
]);

export class OrderManager {
  private readonly tenantId: string;
  private readonly config: OrderManagerConfig;
  private readonly activeOrders = new Map<string, OrderWatchEntry>();
  private defaultPollIntervalMs: number;
  private intervalId: ReturnType<typeof setInterval> | null = null;
  private readonly pollIntervalMs: number;

  constructor(tenantId: string, config: OrderManagerConfig) {
    this.tenantId = tenantId;
    this.config = config;
    this.defaultPollIntervalMs = config.defaultPollIntervalMs ?? 5000;
    this.pollIntervalMs = config.defaultPollIntervalMs ?? 5000;
  }

  /** Поставить заказ на наблюдение */
  registerOrder(orderId: string, opts: RegisterOrderOptions): void {
    const entry: OrderWatchEntry = {
      orderId: String(orderId),
      botId: opts.botId,
      chatId: opts.chatId,
      tenantId: this.tenantId,
      userId: opts.userId,
      idField: opts.idField,
      lang: opts.lang,
      maxWaitingSecs: opts.maxWaitingSecs ?? 600,
      registeredAt: Date.now(),
      pollIntervalMs: opts.pollIntervalMs ?? this.defaultPollIntervalMs,
      meta: opts.meta,
    };
    this.activeOrders.set(entry.orderId, entry);
    if (orderManagerLoggingEnabled()) {
      orderMgrLog.info('order registered for watching', {
        tenantId: this.tenantId,
        orderId,
        chatId: opts.chatId,
        userId: opts.userId,
      });
    }
  }

  /** Снять заказ с наблюдения */
  unregisterOrder(orderId: string): void {
    this.activeOrders.delete(String(orderId));
  }

  /** Детали заказа из реестра (без вызова API) */
  getOrderDetails(orderId: string): OrderWatchEntry | undefined {
    return this.activeOrders.get(String(orderId));
  }

  /** Список всех наблюдаемых orderId */
  getActiveOrderIds(): string[] {
    return Array.from(this.activeOrders.keys());
  }

  /** Установить интервал опроса для конкретного заказа */
  setPollInterval(orderId: string, pollIntervalMs: number): void {
    const entry = this.activeOrders.get(String(orderId));
    if (entry) entry.pollIntervalMs = pollIntervalMs;
  }

  /** Интервал по умолчанию для новых заказов */
  setDefaultPollInterval(ms: number): void {
    this.defaultPollIntervalMs = ms;
  }

  /** Запустить цикл опроса (вызывается при старте оркестратора) */
  start(): void {
    if (this.intervalId != null) return;
    this.intervalId = setInterval(() => this.tick(), this.pollIntervalMs);
  }

  /** Остановить цикл */
  stop(): void {
    if (this.intervalId != null) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
  }

  private async tick(): Promise<void> {
    const orderIds = Array.from(this.activeOrders.keys());
    const watched = orderIds.map((id) => {
      const e = this.activeOrders.get(id);
      return e ? { orderId: id, chatId: e.chatId, lastEvent: e.lastEmittedEvent } : id;
    });
    if (orderManagerLoggingEnabled()) {
      orderMgrLog.debug('tick', {
        tenantId: this.tenantId,
        watching: orderIds.length,
        watched,
      });
    }

    for (const orderId of orderIds) {
      const entry = this.activeOrders.get(orderId);
      if (!entry) continue;

      try {
        if (isOutOfTime(entry)) {
          const idField = entry.idField ?? { u_a_phone: String(entry.userId ?? entry.chatId ?? '').replace(/@.*$/, '') };
          await this.config.cancelOrder(orderId, 'Max waiting time exceeded', idField);
          await this.emit(entry, ORDER_STATUS_EVENTS.OUT_OF_TIME);
          this.activeOrders.delete(orderId);
          continue;
        }

        const data = await this.config.getOrderState(orderId, entry.idField);
        if (orderManagerLoggingEnabled()) {
          orderMgrLog.debug('getOrderState', { tenantId: this.tenantId, orderId, hasData: data != null });
        }
        if (data == null) continue;

        if (isOutOfTime(entry, data)) {
          const idField = entry.idField ?? { u_a_phone: String(entry.userId ?? entry.chatId ?? '').replace(/@.*$/, '') };
          await this.config.cancelOrder(orderId, 'Max waiting time exceeded (API)', idField);
          await this.emit(entry, ORDER_STATUS_EVENTS.OUT_OF_TIME);
          this.activeOrders.delete(orderId);
          continue;
        }

        const event = deriveEvent(data);
        if (event !== entry.lastEmittedEvent) {
          entry.lastEmittedEvent = event;
          await this.emit(entry, event);
        }

        if (TERMINAL_EVENTS.has(event)) {
          this.activeOrders.delete(orderId);
        }
      } catch (err) {
        if (orderManagerLoggingEnabled()) {
          orderMgrLog.error('tick error', { tenantId: this.tenantId, orderId, error: err });
        }
      }
    }
  }

  private async emit(entry: OrderWatchEntry, event: OrderStatusEvent): Promise<void> {
    const payload: SystemEventPayload = {
      tenantId: this.tenantId,
      botId: entry.botId,
      chatId: entry.chatId,
      userId: entry.userId,
      event,
      payload: { orderId: entry.orderId },
    };
    await this.config.onSystemEvent(payload);
  }
}
