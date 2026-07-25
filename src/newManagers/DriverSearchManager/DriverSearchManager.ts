/**
 * DriverSearchManager — фоновый поиск водителей для children.
 * При инициализации получает APIManager и FSM напрямую (как FSM) и обращается к API только через APIManager.
 * Хранит только chatId → { timerId, messageId } в памяти. Никаких инстансов в Redis.
 * При завершении вызывает onSystemEvent с drivers_found или no_drivers.
 */
import type {
  DriverSearchManagerConfig,
  DriverSearchSystemPayload,
  DriverItem,
  FormattedDriverList,
  IAPIManagerForDriverSearch,
  IDriverSearchFSM,
} from './types';
import { DRIVER_SEARCH_EVENTS } from './types';
import { getOrderInputSlice } from '../../engine/handlers/children/fsmStorage';
import { getTaggedLogger } from '../../addons/logger';

const drSearchLog = getTaggedLogger('DriverSearch');

/** Логи поиска водителей: `DRIVER_SEARCH_LOG=1` */
function driverSearchLoggingEnabled(): boolean {
  return process.env.DRIVER_SEARCH_LOG === '1';
}

interface ChatEntry {
  timerId: ReturnType<typeof setTimeout>;
  messageId?: string;
}

export class DriverSearchManager {
  private readonly config: DriverSearchManagerConfig;
  private readonly tenantId: string;
  private readonly apiManager: IAPIManagerForDriverSearch;
  private readonly fsm: IDriverSearchFSM;
  private readonly activeChats = new Map<string, ChatEntry>();

  constructor(
    tenantId: string,
    apiManager: IAPIManagerForDriverSearch,
    fsm: IDriverSearchFSM,
    config: DriverSearchManagerConfig,
  ) {
    this.tenantId = tenantId;
    this.apiManager = apiManager;
    this.fsm = fsm;
    this.config = config;
  }

  private log(message: string, meta?: Record<string, unknown>): void {
    if (!driverSearchLoggingEnabled()) return;
    drSearchLog.debug(message, { tenantId: this.tenantId, ...meta });
  }

  /** Запустить поиск для чата */
  start(opts: {
    chatId: string;
    botId: string;
    userId?: string;
    messageId?: string;
    maxAttempts?: number;
  }): void {
    this.stop(opts.chatId);
    const { chatId, botId, userId, messageId, maxAttempts = -1 } = opts;
    this.log('[start]', { chatId, userId: userId ?? chatId, botId });
    this.activeChats.set(chatId, {
      timerId: setTimeout(() => this.poll(chatId, botId, userId, messageId, 0, maxAttempts), 0),
      messageId,
    });
  }

  /** Остановить поиск */
  stop(chatId: string): void {
    const entry = this.activeChats.get(String(chatId));
    if (entry) {
      clearTimeout(entry.timerId);
      this.activeChats.delete(String(chatId));
      this.log('[stop]', { chatId });
    }
  }

  /** В чате идёт поиск? */
  isActive(chatId: string): boolean {
    return this.activeChats.has(String(chatId));
  }

  private async poll(
    chatId: string,
    botId: string,
    userId: string | undefined,
    searchMessageId: string | undefined,
    attempts: number,
    maxAttempts: number,
  ): Promise<void> {
    const entry = this.activeChats.get(chatId);
    if (!entry) return;

    const stateKey = String(userId ?? chatId);
    const state = await this.fsm.getState(this.tenantId, stateKey, botId);
        const rawData = await this.fsm.getData(this.tenantId, stateKey, botId);
        const stateData = { currentState: state, ...rawData };
        const data = getOrderInputSlice(rawData) as Record<string, unknown>;

        const whenRaw = data?.when;
        const waiting = data?.waitingForDrivers ?? (rawData as Record<string, unknown>)?.waitingForDrivers;
        const currentState = stateData?.currentState as string | undefined;
        const lat = this.resolveLat(data);
        const lng = this.resolveLng(data);

    this.log('poll', { chatId, userId: stateKey, attempts, maxAttempts, currentState, waiting, lat, lng, whenRaw });

    if (!data || (currentState && !String(currentState).includes('driverSearch'))) {
      this.log('poll -> search_cancelled (no data or wrong state)');
      await this.finishNoDrivers(chatId, botId, userId, searchMessageId, 'search_cancelled');
      return;
    }
    if (whenRaw === undefined) {
      this.log('poll -> no_time');
      await this.finishNoDrivers(chatId, botId, userId, searchMessageId, 'no_time');
      return;
    }
    if (!waiting) {
      this.log('poll -> search_cancelled (no waiting)');
      await this.finishNoDrivers(chatId, botId, userId, searchMessageId, 'search_cancelled');
      return;
    }

    if (lat == null || lng == null) {
      this.log('poll -> no_coords');
      await this.finishNoDrivers(chatId, botId, userId, searchMessageId, 'no_coords');
      return;
    }

    const when = whenRaw === null ? null : whenRaw instanceof Date ? whenRaw : new Date(String(whenRaw));
    const shortPeriod = this.config.searchPeriodShort ?? 15;
    const longPeriod = this.config.searchPeriodLong ?? 60;
    const maxWaiting = this.config.maxDefaultDriveWaiting ?? 3600;
    const interval = when === null
      ? shortPeriod
      : Date.now() - (when?.getTime() ?? 0) + maxWaiting > 3600 ? longPeriod : shortPeriod;

    const calcMaxAttempts = maxAttempts >= 0
      ? maxAttempts
      : Math.floor((Date.now() - (when?.getTime() ?? Date.now()) + maxWaiting) / interval);

    try {
      const drivers = await this.apiManager.getDrivers(Number(lat), Number(lng), (rawData as { user?: { id?: string } })?.user?.id);
      this.log('poll -> getDrivers', { lat, lng, count: drivers?.length ?? 0 });
      if (drivers && drivers.length > 0) {
        this.log('poll -> drivers_found', { count: drivers.length });
        const formatted = this.formatDriversList(drivers);
        const langId = String((rawData as { user?: { lang?: string } })?.user?.lang ?? '1');
        await this.finishDriversFound(chatId, botId, userId, searchMessageId, formatted, langId);
        return;
      }
      // Список пуст — сразу сообщаем и сбрасываем, без попыток 2 из 120
      this.log('poll -> no_drivers (empty list)');
      await this.finishNoDrivers(chatId, botId, userId, searchMessageId, 'no_drivers');
      return;
    } catch (err) {
      if (driverSearchLoggingEnabled()) {
        drSearchLog.error('getDrivers error', { tenantId: this.tenantId, error: err });
      }
      this.log('poll -> getDrivers error', { error: String(err) });
    }

    if (attempts + 1 >= calcMaxAttempts) {
      this.log('poll -> no_drivers (max attempts)', { attempts: attempts + 1, calcMaxAttempts });
      await this.finishNoDrivers(chatId, botId, userId, searchMessageId, 'no_drivers');
      return;
    }

    this.log('poll -> retry', { nextAttempt: attempts + 1, calcMaxAttempts, intervalSec: interval });
    const retryText = this.config.searchPeriodShort
      ? `Попытка ${attempts + 1} из ${calcMaxAttempts}. Повтор через ${interval} сек.`
      : '';
    if (retryText && this.config.editMessage && searchMessageId) {
      try {
        await this.config.editMessage(chatId, searchMessageId, retryText, botId);
      } catch {
        await this.config.sendMessage(chatId, retryText, botId);
      }
    }

    const nextTimerId = setTimeout(
      () => this.poll(chatId, botId, userId, searchMessageId, attempts + 1, calcMaxAttempts),
      interval * 1000,
    );
    this.activeChats.set(chatId, { ...entry, timerId: nextTimerId });
  }

  private resolveLat(data: Record<string, unknown>): number | null {
    const from = data?.from as Record<string, unknown> | undefined;
    if (from?.latitude != null) return Number(from.latitude);
    if (data?.latitude != null) return Number(data.latitude);
    return null;
  }

  private resolveLng(data: Record<string, unknown>): number | null {
    const from = data?.from as Record<string, unknown> | undefined;
    if (from?.longitude != null) return Number(from.longitude);
    if (data?.longitude != null) return Number(data.longitude);
    return null;
  }

  private formatDriversList(drivers: DriverItem[]): FormattedDriverList {
    const drivers_map: Record<string, string> = {};
    let text = '';
    for (let i = 0; i < drivers.length; i++) {
      const d = drivers[i];
      let json_field: Record<string, unknown> = {};
      try {
        if (d.json) json_field = JSON.parse(String(d.json));
      } catch {}
      const age = json_field.age ? ` ${json_field.age}` : '';
      const dist = d.distance ? ` ${d.distance} км` : '';
      text += `*${i + 1}*    ${d.name || ''}${d.family ? ` ${d.family}` : ''}${age}${dist}\n`;
      drivers_map[String(i + 1)] = d.id_user;
    }
    return { text, drivers_map };
  }

  private async finishDriversFound(
    chatId: string,
    botId: string,
    userId: string | undefined,
    searchMessageId: string | undefined,
    formatted: FormattedDriverList,
    langId = '1',
  ): Promise<void> {
    this.log('finishDriversFound', { chatId, userId, driversCount: Object.keys(formatted.drivers_map).length, searchMessageId });
    this.stop(chatId);
    const promptText = this.config.getLangValue
      ? await this.config.getLangValue('wab_selectBabySisterRange', langId)
          .catch(() => 'Выберите няню по номеру из списка:')
      : 'ERR';
    if (!searchMessageId) {
      this.log('finishDriversFound: no searchMessageId, will send new message instead of edit');
    }
    if (this.config.editMessage && searchMessageId) {
      try {
        await this.config.editMessage(chatId, searchMessageId, promptText, botId);
      } catch {
        await this.config.sendMessage(chatId, promptText, botId);
      }
    } else {
      await this.config.sendMessage(chatId, promptText, botId);
    }
    await this.config.sendMessage(chatId, formatted.text, botId);

    const payload: DriverSearchSystemPayload = {
      tenantId: this.tenantId,
      botId,
      chatId,
      userId,
      event: DRIVER_SEARCH_EVENTS.DRIVERS_FOUND,
      payload: {
        driversMap: formatted.drivers_map,
        listText: formatted.text,
      },
    };
    await this.config.onSystemEvent(payload);
  }

  private async finishNoDrivers(
    chatId: string,
    botId: string,
    userId: string | undefined,
    searchMessageId: string | undefined,
    reason: string,
  ): Promise<void> {
    this.log('finishNoDrivers', { chatId, userId, reason });
    this.stop(chatId);
    let cancelText: string;
    if (reason === 'no_drivers' && this.config.getLangValue) {
      const stateKey = String(userId ?? chatId);
      const raw = await this.fsm.getData(this.tenantId, stateKey, botId);
      const noDriversLang = String((raw as { user?: { lang?: string } })?.user?.lang ?? '1');
      cancelText = await this.config.getLangValue('wab_noDriversFoundOrderCancelled', noDriversLang)
        .catch(() => 'Сожалеем, свободных нянь сейчас нет. Заказ отменён.');
    } else if (reason === 'no_drivers') {
      cancelText = 'Сожалеем, свободных нянь сейчас нет. Заказ отменён.';
    } else if (reason === 'search_cancelled') {
      cancelText = 'Поиск отменён.';
    } else if (reason === 'no_coords') {
      cancelText = 'Нет координат.';
    } else if (reason === 'no_time') {
      cancelText = 'Время не указано.';
    } else {
      cancelText = 'Поиск остановлен.';
    }
    // Редактируем сообщение «Ищем свободных нянь» на «Сожалеем...» — без нового сообщения
    if (this.config.editMessage && searchMessageId) {
      try {
        await this.config.editMessage(chatId, searchMessageId, cancelText, botId);
      } catch {
        await this.config.sendMessage(chatId, cancelText, botId);
      }
    } else {
      await this.config.sendMessage(chatId, cancelText, botId);
    }

    const payload: DriverSearchSystemPayload = {
      tenantId: this.tenantId,
      botId,
      chatId,
      userId,
      event: DRIVER_SEARCH_EVENTS.NO_DRIVERS,
      payload: { reason },
    };
    await this.config.onSystemEvent(payload);
  }
}
