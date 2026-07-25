// ==================== БАЗОВЫЕ ТИПЫ ====================
import {AdapterConfig} from "../../transport";

interface AdminCredentials {
    login: string;
    password: string;
    type: "e-mail" | "token" | "basic";
}

interface ApiConfig {
    url: string;
    adminCredentials: AdminCredentials;
}


interface TransportConfig {
    type: "telegram-bot-polling" | "telegram-bot-webhook" | "whatsapp-web-polling" | "test";
    token?: string; // для Telegram
    sessionDir?: string; // для WhatsApp
    config?: AdapterConfig
}

interface CoreConfig {
    name: string;
    version?: number;
    language?: string;
    timezone?: string;
}

interface BotConfig {
    api: string; // ссылка на ID в apis
    transport: TransportConfig;
    core: CoreConfig;
}


// Корневая конфигурация
interface RootConfig {
    api: ApisConfig;
    bots: BotsConfig;
}
/**
 * Учетные данные администратора
 */
interface AdminCredentials {
    login: string;
    password: string;
    type: "e-mail" | "token" | "basic";
}

/**
 * Конфигурация API
 */
interface ApiConfig {
    url: string;
    adminCredentials: AdminCredentials;
    adminAuthFile: string
}

/**
 * Словарь конфигураций API (ключ - ID API)
 */
interface ApisConfig {
    [apiId: string]: ApiConfig;
}

/**
 * Типы транспорта для ботов
 */
type TransportType = "telegram-bot-polling" | "telegram-bot-webhook" | "whatsapp-web-polling" | "test";

/**
 * Конфигурация транспорта
 */
interface TransportConfig {
    type: TransportType;
    token?: string; // для Telegram
    sessionDir?: string; // для WhatsApp
}

/**
 * Базовая конфигурация бота
 */
interface CoreConfig {
    name: string;
    version?: number;
    language?: string;
    timezone?: string;
}

/**
 * Конфигурация бота
 */
interface BotConfig {
    api: string; // ссылка на ID в apis
    transport: TransportConfig;
    core: CoreConfig;
}

/**
 * Словарь ботов (ключ - ID бота)
 */
interface BotsConfig {
    [botId: string]: BotConfig;
}

/**
 * Специфичные значения для тенанта (тестовый режим и т.д.)
 */
interface TenantOverrides {
    /** Рефкод пользователя в тестовом режиме (напр. "666") */
    testRefCode?: string;
    [key: string]: string | number | boolean | undefined;
}

/**
 * Корневая конфигурация
 */
interface RootConfig {
    api: ApisConfig;
    bots: BotsConfig;
    /** Специфичные значения по тенантам: testRefCode и др. */
    tenantOverrides?: {
        [tenantId: string]: TenantOverrides;
    };
}

/**
 * Типы источников данных для загрузки конфигурации
 */
type ConfigSource = string | NodeJS.ArrayBufferView | RootConfig;

/**
 * Тип источника конфигурации
 */
type SourceType = 'file' | 'json-string' | 'buffer' | 'object';

/**
 * Результат валидации конфигурации
 */
interface ValidationResult {
    valid: boolean;
    errors: string[];
}

/**
 * Полная конфигурация бота с развернутым API
 */
interface FullBotConfig {
    bot: BotConfig;
    api: ApiConfig;
}

// ==================== ИНТЕРФЕЙС КОНФИГУРАТОРА ====================

/**
 * Интерфейс конфигуратора ботов
 * Определяет контракт для работы с конфигурациями ботов и API
 */
interface IConfigurationOrchestrator {
    // ==================== ЗАГРУЗКА ====================

    /**
     * Асинхронная загрузка конфигурации
     */
    loadConfig(): Promise<void>;

    /**
     * Синхронная загрузка конфигурации
     */
    loadConfigSync(): void;

    /**
     * Перезагрузка конфигурации
     */
    reload(): Promise<void>;

    // ==================== МЕТОДЫ ДЛЯ РАБОТЫ С API ====================

    /**
     * Получить все конфигурации API
     */
    getAllApis(): Map<string, ApiConfig>;

    /**
     * Получить конфигурацию API по ID
     */
    getApi(apiId: string): ApiConfig | undefined;

    /**
     * Получить количество API конфигураций
     */
    getApisCount(): number;

    /**
     * Получить все ID API
     */
    getApiIds(): string[];

    // ==================== МЕТОДЫ ДЛЯ РАБОТЫ С БОТАМИ ====================

    /**
     * Получить всех ботов
     */
    getAllBots(): Map<string, BotConfig>;

    /**
     * Получить конфигурацию бота по ID
     */
    getBot(botId: string): BotConfig | undefined;

    /**
     * Получить количество ботов
     */
    getBotsCount(): number;

    /**
     * Получить все ID ботов
     */
    getBotIds(): string[];

    // ==================== МЕТОДЫ ДЛЯ РАБОТЫ С ОБЪЕДИНЕННЫМИ ДАННЫМИ ====================

    /**
     * Получить полную конфигурацию бота с развернутым API
     */
    getFullBotConfig(botId: string): FullBotConfig | undefined;

    /**
     * Получить всех ботов с развернутыми API конфигурациями
     */
    getAllFullBots(): Map<string, FullBotConfig>;

    /**
     * Получить все API, которые используются ботами
     */
    getUsedApis(): Set<string>;

    /**
     * Получить все API, которые НЕ используются ботами
     */
    getUnusedApis(): Map<string, ApiConfig>;

    // ==================== МЕТОДЫ ДЛЯ ВАЛИДАЦИИ ====================

    /**
     * Проверить целостность конфигурации
     */
    validateConfig(): ValidationResult;

    // ==================== МЕТОДЫ ДЛЯ ТЕСТИРОВАНИЯ ====================

    /**
     * Получить сырую конфигурацию (для тестов)
     */
    getRawConfig(): RootConfig | null;

    /**
     * Установить конфигурацию напрямую (для тестов)
     */
    setConfig(config: RootConfig): void;

    /**
     * Очистить конфигурацию (для тестов)
     */
    clearConfig(): void;

    /**
     * Получить тип источника
     */
    getSourceType(): SourceType;
}

// ==================== ЭКСПОРТ ====================

export {
    // Интерфейсы и типы
    IConfigurationOrchestrator,

    // Типы данных
    AdminCredentials,
    ApiConfig,
    ApisConfig,
    TransportType,
    TransportConfig,
    CoreConfig,
    BotConfig,
    BotsConfig,
    RootConfig,
    TenantOverrides,
    ConfigSource,
    SourceType,
    ValidationResult,
    FullBotConfig,
};