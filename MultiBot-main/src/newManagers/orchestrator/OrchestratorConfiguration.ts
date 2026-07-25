// ==================== ТИПЫ ====================

import {
    ApiConfig,
    BotConfig,
    IConfigurationOrchestrator,
    RootConfig,
    SourceType
} from "./types";


// Типы источников данных
type ConfigSource = string | NodeJS.ArrayBufferView | RootConfig;

// ==================== АСИНХРОННАЯ ВЕРСИЯ ====================

import * as fs from "node:fs";
import * as fsAsync from "node:fs/promises";
import { getTaggedLogger } from "../../addons/logger";

const ocLog = getTaggedLogger("OrchestratorConfig");

class AsyncConfigurationOrchestrator implements IConfigurationOrchestrator {
    private configSource: ConfigSource;
    private rootConfig: RootConfig | null = null;
    private sourceType: 'file' | 'json-string' | 'buffer' | 'object';

    constructor(configSource: ConfigSource) {
        this.configSource = configSource;
        this.sourceType = this.detectSourceType(configSource);
    }

    /**
     * Определение типа источника данных
     */
    private detectSourceType(source: ConfigSource): 'file' | 'json-string' | 'buffer' | 'object' {
        if (typeof source === 'string') {
            // Проверяем, похоже ли на путь к файлу или JSON строку
            if (source.trim().startsWith('{') || source.trim().startsWith('[')) {
                return 'json-string';
            } else {
                return 'file';
            }
        } else if (Buffer.isBuffer(source) || ArrayBuffer.isView(source)) {
            return 'buffer';
        } else if (typeof source === 'object' && source !== null) {
            return 'object';
        }
        throw new Error('Неподдерживаемый тип источника данных');
    }

    /**
     * Загрузка конфигурации из строки (предполагаем, что это JSON)
     */
    private loadFromJsonString(str: string): RootConfig {
        try {
            return JSON.parse(str) as RootConfig;
        } catch (error) {
            throw new Error(`Ошибка парсинга JSON строки: ${error}`);
        }
    }

    /**
     * Загрузка конфигурации из файла
     */
    private async loadFromFile(filePath: string): Promise<RootConfig> {
        try {
            const fileContent = await fsAsync.readFile(filePath, 'utf-8');
            return JSON.parse(fileContent) as RootConfig;
        } catch (error) {
            throw new Error(`Ошибка загрузки файла ${filePath}: ${error}`);
        }
    }

    /**
     * Синхронная загрузка конфигурации из файла
     */
    private loadFromFileSync(filePath: string): RootConfig {
        try {
            const fileContent = fs.readFileSync(filePath, 'utf-8');
            return JSON.parse(fileContent) as RootConfig;
        } catch (error) {
            throw new Error(`Ошибка загрузки файла ${filePath}: ${error}`);
        }
    }

    /**
     * Загрузка конфигурации из буфера
     */
    private loadFromBuffer(buffer: NodeJS.ArrayBufferView): RootConfig {
        try {
            // Корректное преобразование буфера в строку
            let str: string;

            if (Buffer.isBuffer(buffer)) {
                // Если это уже Buffer
                str = buffer.toString('utf-8');
            } else if (ArrayBuffer.isView(buffer)) {
                // Если это ArrayBufferView (Uint8Array и т.д.)
                str = Buffer.from(buffer.buffer, buffer.byteOffset, buffer.byteLength).toString('utf-8');
            } else {
                throw new Error('Неподдерживаемый тип буфера');
            }

            // Удаляем возможные BOM и лишние пробелы
            str = str.trim();

            return JSON.parse(str) as RootConfig;
        } catch (error) {
            throw new Error(`Ошибка парсинга буфера: ${error}`);
        }
    }

    /**
     * Асинхронная загрузка конфигурации
     */
    async loadConfig(): Promise<void> {
        try {
            switch (this.sourceType) {
                case 'file':
                    this.rootConfig = await this.loadFromFile(this.configSource as string);
                    break;

                case 'json-string':
                    this.rootConfig = this.loadFromJsonString(this.configSource as string);
                    break;

                case 'buffer':
                    this.rootConfig = this.loadFromBuffer(this.configSource as NodeJS.ArrayBufferView);
                    break;

                case 'object':
                    this.rootConfig = this.configSource as RootConfig;
                    break;
            }

            ocLog.info(
                `loaded (${this.sourceType}) apis=${this.getApisCount()} bots=${this.getBotsCount()}`,
            );

            const validation = this.validateConfig();
            if (!validation.valid) {
                ocLog.warn("validation failed", { errors: validation.errors });
            }
        } catch (error) {
            ocLog.error("load failed", { error });
            throw error;
        }
    }

    /**
     * Синхронная загрузка конфигурации
     */
    loadConfigSync(): void {
        try {
            switch (this.sourceType) {
                case 'file':
                    this.rootConfig = this.loadFromFileSync(this.configSource as string);
                    break;

                case 'json-string':
                    this.rootConfig = this.loadFromJsonString(this.configSource as string);
                    break;

                case 'buffer':
                    this.rootConfig = this.loadFromBuffer(this.configSource as NodeJS.ArrayBufferView);
                    break;

                case 'object':
                    this.rootConfig = this.configSource as RootConfig;
                    break;
            }

            ocLog.info(`loaded sync (${this.sourceType})`);
        } catch (error) {
            ocLog.error("sync load failed", { error });
            throw error;
        }
    }

    // ==================== МЕТОДЫ ДЛЯ РАБОТЫ С API ====================

    /**
     * Получить все конфигурации API
     */
    getAllApis(): Map<string, ApiConfig> {
        if (!this.rootConfig) throw new Error('Configuration not loaded');
        return new Map(Object.entries(this.rootConfig.api));
    }

    /**
     * Получить конфигурацию API по ID
     */
    getApi(apiId: string): ApiConfig | undefined {
        return this.rootConfig?.api[apiId];
    }

    /**
     * Получить количество API конфигураций
     */
    getApisCount(): number {
        return this.rootConfig ? Object.keys(this.rootConfig.api).length : 0;
    }

    /**
     * Получить все ID API
     */
    getApiIds(): string[] {
        return this.rootConfig ? Object.keys(this.rootConfig.api) : [];
    }

    // ==================== МЕТОДЫ ДЛЯ РАБОТЫ С БОТАМИ ====================

    /**
     * Получить всех ботов
     */
    getAllBots(): Map<string, BotConfig> {
        if (!this.rootConfig) throw new Error('Configuration not loaded');
        return new Map(Object.entries(this.rootConfig.bots));
    }

    /**
     * Получить конфигурацию бота по ID
     */
    getBot(botId: string): BotConfig | undefined {
        return this.rootConfig?.bots[botId];
    }

    /**
     * Получить количество ботов
     */
    getBotsCount(): number {
        return this.rootConfig ? Object.keys(this.rootConfig.bots).length : 0;
    }

    /**
     * Получить все ID ботов
     */
    getBotIds(): string[] {
        return this.rootConfig ? Object.keys(this.rootConfig.bots) : [];
    }

    // ==================== МЕТОДЫ ДЛЯ РАБОТЫ С ОБЪЕДИНЕННЫМИ ДАННЫМИ ====================

    /**
     * Получить полную конфигурацию бота с развернутым API
     */
    getFullBotConfig(botId: string): { bot: BotConfig; api: ApiConfig } | undefined {
        const bot = this.getBot(botId);
        if (!bot) return undefined;

        const api = this.getApi(bot.api);
        if (!api) {
            ocLog.warn(`bot "${botId}" references missing API`, { apiId: bot.api });
            return undefined;
        }

        return { bot, api };
    }

    /**
     * Получить всех ботов с развернутыми API конфигурациями
     */
    getAllFullBots(): Map<string, { bot: BotConfig; api: ApiConfig }> {
        if (!this.rootConfig) throw new Error('Configuration not loaded');

        const result = new Map<string, { bot: BotConfig; api: ApiConfig }>();

        for (const [botId, botConfig] of Object.entries(this.rootConfig.bots)) {
            const apiConfig = this.rootConfig.api[botConfig.api];
            if (apiConfig) {
                result.set(botId, { bot: botConfig, api: apiConfig });
            } else {
                ocLog.warn(`bot "${botId}" references missing API`, { apiId: botConfig.api });
            }
        }

        return result;
    }

    /**
     * Получить все API, которые используются ботами
     */
    getUsedApis(): Set<string> {
        if (!this.rootConfig) throw new Error('Configuration not loaded');

        const usedApis = new Set<string>();
        for (const botConfig of Object.values(this.rootConfig.bots)) {
            usedApis.add(botConfig.api);
        }
        return usedApis;
    }

    /**
     * Получить все API, которые НЕ используются ботами
     */
    getUnusedApis(): Map<string, ApiConfig> {
        if (!this.rootConfig) throw new Error('Configuration not loaded');

        const usedApis = this.getUsedApis();
        const unusedApis = new Map<string, ApiConfig>();

        for (const [apiId, apiConfig] of Object.entries(this.rootConfig.api)) {
            if (!usedApis.has(apiId)) {
                unusedApis.set(apiId, apiConfig);
            }
        }

        return unusedApis;
    }

    // ==================== МЕТОДЫ ДЛЯ ВАЛИДАЦИИ ====================

    /**
     * Проверить целостность конфигурации
     */
    validateConfig(): { valid: boolean; errors: string[] } {
        const errors: string[] = [];

        if (!this.rootConfig) {
            errors.push('Configuration not loaded');
            return { valid: false, errors };
        }

        // Проверяем наличие обязательных секций
        if (!this.rootConfig.api) {
            errors.push('Missing "api" section in config');
        }
        if (!this.rootConfig.bots) {
            errors.push('Missing "bots" section in config');
        }

        // Проверяем, что все ссылки api в ботах существуют
        if (this.rootConfig.api && this.rootConfig.bots) {
            for (const [botId, botConfig] of Object.entries(this.rootConfig.bots)) {
                if (!this.rootConfig.api[botConfig.api]) {
                    errors.push(`Bot "${botId}" references non-existent API: ${botConfig.api}`);
                }
            }
        }

        return {
            valid: errors.length === 0,
            errors
        };
    }

    // ==================== МЕТОДЫ ДЛЯ ТЕСТИРОВАНИЯ ====================

    /**
     * Получить сырую конфигурацию (для тестов)
     */
    getRawConfig(): RootConfig | null {
        return this.rootConfig;
    }

    /**
     * Установить конфигурацию напрямую (для тестов)
     */
    setConfig(config: RootConfig): void {
        this.rootConfig = config;
        this.sourceType = 'object';
        this.configSource = config;
    }

    /**
     * Очистить конфигурацию (для тестов)
     */
    clearConfig(): void {
        this.rootConfig = null;
    }

    // ==================== ОБЩИЕ МЕТОДЫ ====================

    async reload(): Promise<void> {
        ocLog.info("reload");
        await this.loadConfig();
    }

    /**
     * Получить тип источника
     */
    getSourceType(): SourceType {
        return this.sourceType;
    }
}

// ==================== ПРИМЕРЫ ИСПОЛЬЗОВАНИЯ ====================

// 1. Загрузка из файла
async function exampleFromFile() {
    console.log('\n=== Пример 1: Загрузка из файла ===');
    try {
        const config = new AsyncConfigurationOrchestrator('config/orchestrator.json');
        await config.loadConfig();
        console.log('Ботов загружено:', config.getBotsCount());
        console.log('Тип источника:', config.getSourceType());
    } catch (error) {
        console.log('Файл не найден, пропускаем пример');
    }
}

// 2. Загрузка из JSON строки
async function exampleFromJsonString() {
    console.log('\n=== Пример 2: Загрузка из JSON строки ===');
    const jsonString = JSON.stringify({
        api: {
            "a3e4bbff": {
                "url": "https://api.example.com/v1/",
                "adminCredentials": {
                    "login": "admin@example.com",
                    "password": "password123",
                    "type": "e-mail"
                }
            }
        },
        bots: {
            "testBot": {
                "api": "a3e4bbff",
                "transport": {
                    "type": "telegram-bot-polling"
                },
                "core": {
                    "name": "test",
                    "version": 1
                }
            }
        }
    });

    const config = new AsyncConfigurationOrchestrator(jsonString);
    await config.loadConfig();
    console.log('Тип источника:', config.getSourceType());
    console.log('API загружено:', config.getApisCount());
    console.log('Ботов загружено:', config.getBotsCount());
}

// 3. Загрузка из буфера
async function exampleFromBuffer() {
    console.log('\n=== Пример 3: Загрузка из буфера ===');
    const configObject = {
        api: {
            "api123": {
                "url": "https://api.example.com/v1/",
                "adminCredentials": {
                    "login": "admin",
                    "password": "pass",
                    "type": "e-mail"
                }
            }
        },
        bots: {
            "bot123": {
                "api": "api123",
                "transport": {
                    "type": "whatsapp-web-polling",
                    "sessionDir": "./sessions"
                },
                "core": {
                    "name": "whatsapp-bot",
                    "version": 1,
                    "language": "ru"
                }
            }
        }
    };

    // Разные способы создания буфера
    const jsonString = JSON.stringify(configObject);
    console.log('JSON строка:', jsonString);

    // Способ 1: Buffer.from
    const buffer1 = Buffer.from(jsonString, 'utf-8');
    console.log('Buffer1 создан, длина:', buffer1.length);

    const config1 = new AsyncConfigurationOrchestrator(buffer1);
    await config1.loadConfig();

    const fullBots = config1.getAllFullBots();
    fullBots.forEach(({ bot, api }, botId) => {
        console.log(`Бот ${botId}: ${api.url}, тип: ${bot.transport.type}`);
    });

    // Способ 2: Uint8Array
    console.log('\n--- Загрузка из Uint8Array ---');
    const encoder = new TextEncoder();
    const uint8Array = encoder.encode(jsonString);
    const config2 = new AsyncConfigurationOrchestrator(uint8Array);
    await config2.loadConfig();
    console.log('Ботов загружено из Uint8Array:', config2.getBotsCount());
}

// 4. Загрузка из готового объекта (для тестов)
async function exampleFromObject() {
    console.log('\n=== Пример 4: Загрузка из объекта (для тестов) ===');
    const testConfig: RootConfig = {
        api: {
            "test-api": {
                url: "https://test.com/api",
                adminCredentials: {
                    login: "test",
                    password: "test",
                    type: "e-mail"
                },
                adminAuthFile: ''
            }
        },
        bots: {
            "test-bot": {
                api: "test-api",
                transport: {
                    type: "telegram-bot-polling",
                    token: "123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11"
                },
                core: {
                    name: "test-bot",
                    version: 1,
                    language: "en",
                    timezone: "UTC"
                }
            },
            "test-bot-2": {
                api: "test-api",
                transport: {
                    type: "telegram-bot-webhook"
                },
                core: {
                    name: "test-bot-2",
                    version: 1
                }
            }
        }
    };

    const config = new AsyncConfigurationOrchestrator(testConfig);
    await config.loadConfig();

    // Проверка валидации
    const validation = config.validateConfig();
    console.log('Конфигурация валидна:', validation.valid);

    // Получаем данные
    const bot = config.getFullBotConfig('test-bot');
    console.log('Бот:', bot?.bot.core.name);
    console.log('API URL:', bot?.api.url);

    // Проверяем используемые API
    const usedApis = config.getUsedApis();
    console.log('Используемые API:', Array.from(usedApis));

    // Все боты с деталями
    console.log('\nВсе боты:');
    config.getAllFullBots().forEach(({ bot, api }, botId) => {
        console.log(`  ${botId}: ${bot.core.name} (${bot.transport.type}) -> ${api.url}`);
    });
}

// 5. Пример синхронной загрузки
function exampleSync() {
    console.log('\n=== Пример 5: Синхронная загрузка ===');
    const testConfig: RootConfig = {
        api: {
            "sync-api": {
                url: "https://sync.com/api",
                adminCredentials: {
                    login: "sync",
                    password: "sync",
                    type: "e-mail"
                },
                adminAuthFile: ''
            }
        },
        bots: {
            "sync-bot": {
                api: "sync-api",
                transport: {
                    type: "telegram-bot-polling"
                },
                core: {
                    name: "sync-bot",
                    version: 1
                }
            }
        }
    };

    const config = new AsyncConfigurationOrchestrator(testConfig);
    config.loadConfigSync();
    console.log('Ботов загружено синхронно:', config.getBotsCount());
}

// Запускаем примеры
async function runExamples() {
    console.log('🚀 Запуск примеров использования AsyncConfigurationOrchestrator');
    console.log('='.repeat(60));

    await exampleFromFile().catch(e => console.log('Пропускаем file example'));
    await exampleFromJsonString();
    await exampleFromBuffer();
    await exampleFromObject();
    exampleSync();

    console.log('\n' + '='.repeat(60));
    console.log('✅ Все примеры выполнены');
}

// Раскомментируйте для запуска
//runExamples().catch(console.error);

// ==================== ЭКСПОРТ ====================

export {
    AsyncConfigurationOrchestrator,
    type RootConfig,
    type ApiConfig,
    type BotConfig,
    type ConfigSource
};