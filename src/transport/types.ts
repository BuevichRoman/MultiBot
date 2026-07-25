// ==================== ПЛАТФОРМЫ ====================

/**
 * Поддерживаемые платформы
 */
export type Platform = 'telegram' | 'whatsapp' | 'test';

/**
 * Типы сообщений
 */
export type MessageType = 'text' | 'location' | 'unsupported';

// ==================== ПОЛЬЗОВАТЕЛЬ ====================

/**
 * Информация об отправителе
 */
export interface UserInfo {
    /** ID пользователя на платформе */
    id: string;
    /** Имя */
    firstName?: string;
    /** Фамилия */
    lastName?: string;
    /** Username */
    username?: string;
    /** Номер телефона (для WhatsApp) */
    phoneNumber?: string;
}

// ==================== СООБЩЕНИЯ ====================

/**
 * Базовые поля сообщения
 */
export interface BaseMessage {
    /** Уникальный ID сообщения на платформе */
    id: string;
    /** ID чата */
    chatId: string;
    /** Отправитель */
    from: UserInfo;
    /** Временная метка (ms) */
    timestamp: number;
    /** Платформа */
    platform: Platform;
}

/**
 * Текстовое сообщение
 */
export interface TextMessage extends BaseMessage {
    type: 'text';
    text: string;
}

/**
 * Сообщение с геолокацией
 */
export interface LocationMessage extends BaseMessage {
    type: 'location';
    location: {
        latitude: string;
        longitude: string;
        /** Трансляция геолокации (live) */
        live?: boolean;
    };
}

/**
 * Неподдерживаемый тип сообщения
 */
export interface UnsupportedMessage extends BaseMessage {
    type: 'unsupported';
    reason: string;
}

/**
 * Объединенный тип сообщения (для дискриминированного union)
 */
export type AnyMessage = TextMessage | LocationMessage | UnsupportedMessage;

// ==================== РЕЗУЛЬТАТЫ ОПЕРАЦИЙ ====================

/**
 * Результат отправки сообщения
 */
export interface SendResult {
    /** ID отправленного сообщения */
    messageId: string;
    /** Временная метка отправки */
    timestamp: number;
}

/**
 * Результат редактирования сообщения
 */
export interface EditResult {
    /** Успешно ли */
    success: boolean;
    /** ID сообщения */
    messageId: string;
    /** Новый текст */
    newText: string;
    /** Временная метка */
    timestamp: number;
    /** Требуется ли проверка (для WhatsApp) */
    needsVerification?: boolean;
}

/**
 * Результат удаления сообщения
 */
export interface DeleteResult {
    /** Успешно ли */
    success: boolean;
    /** ID сообщения */
    messageId: string;
    /** Удалено ли у всех */
    forEveryone: boolean;
}

// ==================== ВОЗМОЖНОСТИ АДАПТЕРА ====================

/**
 * Возможности платформы
 */
export interface Capabilities {
    /** Поддерживает редактирование */
    canEdit: boolean;
    /** Поддерживает удаление */
    canDelete: boolean;
    /** Поддерживает закрепление */
    canPin: boolean;
    /** Лимит времени на редактирование (мс) */
    editTimeLimit?: number;
    /** Поддерживает удаление у всех */
    deleteForEveryone?: boolean;
    /** Максимальная длина сообщения */
    maxMessageLength?: number;
    /** Поддерживает Markdown */
    supportsMarkdown?: boolean;
    /** Поддерживает HTML */
    supportsHTML?: boolean;
}

// ==================== КОНФИГУРАЦИЯ ====================

/**
 * Конфигурация адаптера
 */
export interface AdapterConfig {
    /** Тип платформы */
    platform: Platform;
    /** ID бота */
    botId: string;
    /** Директория для сессий */
    sessionDir?: string;
    /** Токен (для Telegram) */
    token?: string;
    /** Webhook URL */
    webhookUrl?: string;
    /** Порт для webhook */
    port?: number;
}

// ==================== СОБЫТИЯ ====================

/**
 * Типы событий адаптера
 */
export type AdapterEvent = 'message' | 'ready' | 'error' | 'qr' | 'disconnected';

/**
 * Обработчик событий
 */
export type EventHandler<T = any> = (data: T) => void | Promise<void>;

// ==================== ОШИБКИ ====================

/**
 * Ошибки адаптера
 */
export class AdapterError extends Error {
    constructor(
        message: string,
        public readonly platform: Platform,
        public readonly code: string,
        public readonly originalError?: any
    ) {
        super(message);
        this.name = 'AdapterError';
    }
}

/**
 * Коды ошибок
 */
export enum ErrorCode {
    NOT_INITIALIZED = 'NOT_INITIALIZED',
    NOT_READY = 'NOT_READY',
    SEND_FAILED = 'SEND_FAILED',
    EDIT_FAILED = 'EDIT_FAILED',
    DELETE_FAILED = 'DELETE_FAILED',
    NOT_SUPPORTED = 'NOT_SUPPORTED',
    AUTH_FAILED = 'AUTH_FAILED',
    DISCONNECTED = 'DISCONNECTED',
    UNKNOWN = 'UNKNOWN'
}

// ==================== УТИЛИТЫ ====================

/**
 * Type guard для текстовых сообщений
 */
export function isTextMessage(message: AnyMessage): message is TextMessage {
    return message.type === 'text';
}

/**
 * Type guard для location сообщений
 */
export function isLocationMessage(message: AnyMessage): message is LocationMessage {
    return message.type === 'location';
}

/**
 * Type guard для неподдерживаемых сообщений
 */
export function isUnsupportedMessage(message: AnyMessage): message is UnsupportedMessage {
    return message.type === 'unsupported';
}

/**
 * Функция для создания текстового сообщения
 */
export function createTextMessage(
    id: string,
    chatId: string,
    from: UserInfo,
    timestamp: number,
    platform: Platform,
    text: string
): TextMessage {
    return {
        id,
        chatId,
        from,
        timestamp,
        platform,
        type: 'text',
        text
    };
}

/**
 * Функция для создания location сообщения
 */
export function createLocationMessage(
    id: string,
    chatId: string,
    from: UserInfo,
    timestamp: number,
    platform: Platform,
    latitude: string,
    longitude: string,
    live?: boolean
): LocationMessage {
    return {
        id,
        chatId,
        from,
        timestamp,
        platform,
        type: 'location',
        location: { latitude, longitude, live }
    };
}

/**
 * Функция для создания неподдерживаемого сообщения
 */
export function createUnsupportedMessage(
    id: string,
    chatId: string,
    from: UserInfo,
    timestamp: number,
    platform: Platform,
    reason: string
): UnsupportedMessage {
    return {
        id,
        chatId,
        from,
        timestamp,
        platform,
        type: 'unsupported',
        reason
    };
}

// ==================== ИНТЕРФЕЙС АДАПТЕРА ====================

/**
 * Интерфейс адаптера сообщений
 */
export interface IMessageAdapter {
    /** Получить платформу */
    getPlatform(): Platform;
    /** Возможности */
    readonly capabilities: Capabilities;

    /** Отправить сообщение */
    sendMessage(chatId: string, text: string, options?: { replyTo?: string; params?: Record<string,string> }): Promise<SendResult>;
    /** Отправить локацию */
    sendLocation(chatId: string, lat: string, lng: string): Promise<SendResult>;
    /** Отправить действие */
    sendAction(chatId: string, action: 'typing' | 'uploading'): Promise<void>;

    /** Опционально: редактировать (chatId нужен для Telegram) */
    editMessage?(chatId: string, messageId: string, newText: string): Promise<EditResult>;
    /** Опционально: удалить */
    deleteMessage?(messageId: string, forEveryone: boolean): Promise<DeleteResult>;

    /** Подписка на события */
    on(event: 'message', handler: (message: AnyMessage) => void): void;
    on(event: 'ready', handler: () => void): void;
    on(event: 'error', handler: (error: Error) => void): void;
    on(event: 'qr', handler: (qr: string) => void): void;
    on(event: 'disconnected', handler: (reason: any) => void): void;
}

// ==================== КОНСТАНТЫ ====================

/**
 * Названия платформ для отображения
 */
export const PlatformNames: Record<Platform, string> = {
    telegram: 'Telegram',
    whatsapp: 'WhatsApp',
    test: 'Test'
};

/**
 * Иконки платформ
 */
export const PlatformIcons: Record<Platform, string> = {
    telegram: '📱',
    whatsapp: '💬',
    test: '🧪'
};

/**
 * Возможности по умолчанию
 */
export const DefaultCapabilities: Capabilities = {
    canEdit: false,
    canDelete: false,
    canPin: false,
    deleteForEveryone: false,
    maxMessageLength: 4096,
    supportsMarkdown: false,
    supportsHTML: false
};

/**
 * Лимиты платформ
 */
export const PlatformLimits: Record<Platform, { maxMessageLength: number }> = {
    telegram: { maxMessageLength: 4096 },
    whatsapp: { maxMessageLength: 65536 },
    test: { maxMessageLength: 1000000 }
};