/**
 * Типы для DriverSearchManager.
 * Менеджер хранит данные чатов только в памяти (никаких инстансов в Redis).
 */

export const DRIVER_SEARCH_EVENTS = {
  DRIVERS_FOUND: 'drivers_found',
  NO_DRIVERS: 'no_drivers',
} as const;

export type DriverSearchEvent = (typeof DRIVER_SEARCH_EVENTS)[keyof typeof DRIVER_SEARCH_EVENTS];

export interface DriverItem {
  id_user: string;
  phone?: string;
  name?: string;
  family?: string;
  distance?: string;
  json?: string;
  [key: string]: unknown;
}

/** Форматированный список: текст для отображения и маппинг номер→id водителя */
export interface FormattedDriverList {
  text: string;
  drivers_map: Record<string, string>;
}

export interface DriverSearchSystemPayload {
  tenantId: string;
  botId: string;
  chatId: string;
  userId?: string;
  event: DriverSearchEvent;
  payload?: {
    driversMap?: Record<string, string>;
    listText?: string;
    reason?: string;
  };
}

/** Минимальный интерфейс API для DriverSearchManager (реализует APIManager). */
export interface IAPIManagerForDriverSearch {
  getDrivers(lat: number, lng: number, userId?: string): Promise<DriverItem[]>;
}

/** Минимальный интерфейс FSM для DriverSearchManager (реализует FSMManager). */
export interface IDriverSearchFSM {
  getState(tenantId: string, userId: string, botId?: string): Promise<string | null>;
  getData(tenantId: string, userId: string, botId?: string): Promise<any>;
}

/** Конфиг DriverSearchManager. API и state — через apiManager и fsm. */
export interface DriverSearchManagerConfig {
  /** Отправить сообщение в чат (botId — для выбора адаптера при нескольких ботах) */
  sendMessage: (chatId: string, text: string, botId?: string) => Promise<{ messageId?: string }>;
  /** Редактировать сообщение (botId — для выбора адаптера) */
  editMessage?: (chatId: string, messageId: string, text: string, botId?: string) => Promise<void>;
  /** Уведомить о завершении поиска */
  onSystemEvent: (payload: DriverSearchSystemPayload) => Promise<void>;
  /** Получить строку локализации по ключу (опционально) */
  getLangValue?: (key: string, lang?: string) => Promise<string>;
  /** Интервалы опроса (сек) */
  searchPeriodShort?: number;
  searchPeriodLong?: number;
  maxDefaultDriveWaiting?: number;
  /** Ожидаемое состояние FSM при поиске (например main.driverSearch) */
  expectedState?: string;
}
