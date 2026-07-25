// orchestrator/Orchestrator.ts

import { AsyncConfigurationOrchestrator } from './OrchestratorConfiguration';
import type { RootConfig, ApiConfig, BotConfig, IConfigurationOrchestrator, TenantOverrides } from './types';
import defaultLogger, { MegaLogger } from '../../addons/logger';
import { IMessageAdapter, AnyMessage, LocationMessage } from '../../transport';
import { APIManager } from '../api/APIManager';
import { TelegramBotPollingAdaptor, TelegramBotWebhookAdaptor, WhatsappWebPollingAdaptor } from '../../transport';
import { OrderManager } from '../OrderManager';
import type { SystemEventPayload, RawOrderData } from '../OrderManager';
import { DriverSearchManager } from '../DriverSearchManager';
import type { DriverSearchSystemPayload } from '../DriverSearchManager';

export interface MessageContext {
    botId: string;
    chatId: string | number;
    userId: string | number;
    text: string;
    timestamp: Date;
    raw: any;
    location?: { latitude: string; longitude: string; live: boolean };
    /** true, если контекст пришёл от OrderManager (system event), а не от адаптера */
    isSystemEvent?: boolean;
    /** Событие для FSM (при isSystemEvent === true) */
    event?: string;
    /** Доп. данные (orderId и т.д.) при isSystemEvent */
    payload?: Record<string, unknown>;
}

export interface OrchestratorConfig {
    configSource: any;
    handlers?: {
        onMessage?: (ctx: MessageContext) => Promise<void>;
        onError?: (ctx: any) => Promise<void>;
    };
    logger?: MegaLogger;
    autoStart?: boolean;
    skipApiLogin?: boolean;
    engine?: any;
}

class Orchestrator {
    private configManager: IConfigurationOrchestrator;
    private handlers: OrchestratorConfig['handlers'];
    private logger?: MegaLogger;
    private bots: Map<string, IMessageAdapter> = new Map();
    private apiManagers: Map<string, APIManager> = new Map();
    private tenantHandlers: Map<string, Function> = new Map();
    private orderManagers: Map<string, OrderManager> = new Map();
    private driverSearchManagers: Map<string, DriverSearchManager> = new Map();
    private engine?: any;
    private skipApiLogin: boolean;
    private configSource: any;

    constructor(config: OrchestratorConfig) {
        this.configSource = config.configSource;
        this.configManager = new AsyncConfigurationOrchestrator(config.configSource);
        this.handlers = config.handlers || {};
        this.logger = config.logger;
        this.engine = config.engine;
        this.skipApiLogin = config.skipApiLogin || false;

        if (config.autoStart) {
            this.start().catch((err) =>
                (this.logger ?? defaultLogger).error('[Orch] autoStart failed', { err }),
            );
        }
    }

    private async ensureConfigLoaded() {
        if (!this.configManager.getRawConfig()) {
            await this.configManager.loadConfig();
        }
    }

    private async createApiManagers() {
        await this.ensureConfigLoaded();

        for (const [apiId, apiCfg] of this.configManager.getAllApis()) {
            try {
                const mgr = new APIManager(
                    apiCfg.url,
                    apiCfg.adminCredentials as any,
                    apiCfg.adminAuthFile ?? '',
                    this.logger || defaultLogger,
                    `[API:${apiId}]`,
                );
                this.apiManagers.set(apiId, mgr);
                if (!this.skipApiLogin) mgr.loginAdmin().catch(() => {});
                if (!mgr.api_data_manager.isLoaded) await mgr.api_data_manager.load();
                mgr.startApiDataVersionWatch();
                this.log('info', `API manager created for ${apiId}`);
            } catch (err) {
                this.log('error', `Failed to create API manager ${apiId}`, err);
            }
        }
    }

    async registerTenantHandler(
        tenantId: string,
        factory: (orch: Orchestrator, engine: any, apiManager: APIManager) => Function
    ): Promise<void> {
        // Создаем API менеджеры если еще не созданы
        if (this.apiManagers.size === 0) {
            await this.createApiManagers();
        }

        const apiManager = this.getApiManagerForTenant(tenantId);
        if (!apiManager) throw new Error(`No API for tenant ${tenantId}`);

        if (this.engine?.loadTenantSchema) {
            await this.engine.loadTenantSchema(tenantId);
        }

        const handler = factory(this, this.engine, apiManager);
        this.tenantHandlers.set(tenantId, handler);
        this.log('info', `Handler registered for ${tenantId}`);
    }

    async start() {
        this.log('info', 'Starting bots...');

        // Убеждаемся что конфиг загружен и API менеджеры созданы
        await this.ensureConfigLoaded();
        if (this.apiManagers.size === 0) {
            await this.createApiManagers();
        }

            await this.startAllBots();
        this.startOrderManagers();
        this.startTaskWorkers();
        this.startDriverSearchManagers();
        this.log('info', `Started: ${this.bots.size} bots, ${this.apiManagers.size} APIs`);
    }

    private startOrderManagers(): void {
        for (const tenantId of this.tenantHandlers.keys()) {
            const apiManager = this.getApiManagerForTenant(tenantId);
            const manager = new OrderManager(tenantId, {
                getOrderState: async (orderId: string, idField?: Record<string, string>): Promise<RawOrderData | null> => {
                    if (apiManager?.getOrderState) return apiManager.getOrderState(orderId, idField);
                    return null;
                },
                cancelOrder: async (orderId: string, reason: string, idField?: Record<string, string>): Promise<void> => {
                    if (apiManager?.cancelOrder) await apiManager.cancelOrder(orderId, reason, idField);
                },
                onSystemEvent: (payload: SystemEventPayload) => this.emitSystemEvent(tenantId, payload),
                defaultPollIntervalMs: 5000,
            });
            this.orderManagers.set(tenantId, manager);
            manager.start();
            this.log('info', `OrderManager started for tenant ${tenantId}`);
        }
    }

    /** Запуск воркеров TaskManager: обработка watch_order → OrderManager.registerOrder */
    private startTaskWorkers(): void {
        const taskManager = this.engine?.getTaskManager?.();
        if (!taskManager?.startWorker) return;

        for (const tenantId of this.tenantHandlers.keys()) {
            taskManager.startWorker(tenantId, async (task: { type?: string; orderId?: string; botId?: string; chatId?: string; userId?: string; idField?: Record<string, string> }) => {
                if (task.type === 'watch_order' && task.orderId) {
                    const orderManager = this.getOrderManager(tenantId);
                    if (orderManager) {
                        orderManager.registerOrder(String(task.orderId), {
                            orderId: String(task.orderId),
                            botId: String(task.botId ?? ''),
                            chatId: String(task.chatId ?? ''),
                            userId: task.userId != null ? String(task.userId) : undefined,
                            idField: task.idField,
                            maxWaitingSecs: 600,
                        });
                        this.log('info', `OrderManager registered order ${task.orderId} for tenant ${tenantId}`);
                    } else {
                        this.log('warn', `OrderManager not found for tenant ${tenantId}, cannot register order ${task.orderId}`);
                    }
                }
            });
            this.log('info', `Task worker started for tenant ${tenantId}`);
        }
    }

    /**
     * Отправить system event в тот же handler, что и сообщения от адаптеров.
     * ctx будет с isSystemEvent: true и event — handler должен делать transition по ctx.event.
     */
    async emitSystemEvent(tenantId: string, payload: SystemEventPayload): Promise<void> {
        const handler = this.tenantHandlers.get(tenantId);
        if (!handler) return;
        const ctx: MessageContext = {
            botId: payload.botId,
            chatId: payload.chatId,
            userId: payload.userId ?? '',
            text: '',
            timestamp: new Date(),
            raw: null,
            isSystemEvent: true,
            event: payload.event,
            payload: payload.payload,
        };
        await handler(ctx);
    }

    getOrderManager(tenantId: string): OrderManager | undefined {
        return this.orderManagers.get(tenantId);
    }

    /** Специфичные значения для тенанта (testRefCode и др.) из config.tenantOverrides */
    getTenantOverrides(tenantId: string): TenantOverrides | undefined {
        const raw = this.configManager.getRawConfig();
        return (raw as RootConfig)?.tenantOverrides?.[tenantId];
    }

    getDriverSearchManager(tenantId: string): DriverSearchManager | undefined {
        return this.driverSearchManagers.get(tenantId);
    }

    /** Вызов для событий DriverSearchManager (drivers_found, no_drivers) */
    async emitDriverSearchEvent(tenantId: string, payload: DriverSearchSystemPayload): Promise<void> {
        const handler = this.tenantHandlers.get(tenantId);
        if (!handler) return;
        const ctx: MessageContext = {
            botId: payload.botId,
            chatId: payload.chatId,
            userId: payload.userId ?? '',
            text: '',
            timestamp: new Date(),
            raw: null,
            isSystemEvent: true,
            event: payload.event,
            payload: payload.payload,
        };
        await handler(ctx);
    }

    private startDriverSearchManagers(): void {
        const tenantId = 'children';
        if (!this.tenantHandlers.has(tenantId)) return;
        const apiManager = this.getApiManagerForTenant(tenantId);
        const fsm = this.engine?.getFSMManager?.();
        const botIds = this.configManager.getBotIds().filter((id) => this.configManager.getBot(id)?.core?.name === tenantId);
        const defaultBotId = botIds[0] || 'test-adapter-bot';

        if (!apiManager?.getDrivers || !fsm) return;

        const dm = apiManager?.api_data_manager;
        const manager = new DriverSearchManager(tenantId, apiManager, fsm, {
            sendMessage: async (chatId, text, botId) => {
                const adapter = this.getAdapter(botId || defaultBotId) as any;
                const res = await adapter?.sendMessage?.(String(chatId), text);
                return { messageId: (res as any)?.messageId };
            },
            editMessage: async (chatId, messageId, text, botId) => {
                const adapter = this.getAdapter(botId || defaultBotId) as any;
                if (adapter?.editMessage) {
                    try {
                        await adapter.editMessage(chatId, messageId, text);
                    } catch (err) {
                        this.log('error', `DriverSearchManager editMessage failed, falling back to sendMessage`, { chatId, messageId, err });
                        await adapter?.sendMessage?.(String(chatId), text);
                    }
                } else {
                    await adapter?.sendMessage?.(String(chatId), text);
                }
            },
            onSystemEvent: (p: DriverSearchSystemPayload) => this.emitSystemEvent(tenantId, {
                tenantId: p.tenantId,
                botId: p.botId,
                chatId: p.chatId,
                userId: p.userId,
                event: p.event,
                payload: p.payload,
            }),
            getLangValue: dm
                ? async (key, lang = '1') => {
                    try {
                        if (!dm.isLoaded) await dm.load();
                        return (await dm.getLangValueItem(key.toLowerCase(), lang)) ?? key;
                    } catch {
                        return key;
                    }
                }
                : undefined,
            searchPeriodShort: 30,
            searchPeriodLong: 60,
            maxDefaultDriveWaiting: 3600,
        });
        this.driverSearchManagers.set(tenantId, manager);
        this.log('info', `DriverSearchManager started for tenant ${tenantId}`);
    }

    private async startAllBots() {
        for (const [botId, full] of this.configManager.getAllFullBots()) {
            await this.startBot(botId, full.bot).catch(e =>
                this.log('error', `Bot ${botId} failed`, e));
        }
    }

    private async startBot(botId: string, botConfig: BotConfig) {
        const adapter = this.createAdapter(botId, botConfig);
        this.bots.set(botId, adapter);

        adapter.on('message', async (msg: AnyMessage) => {
                const context: MessageContext = {
                    botId,
                    chatId: (msg as any).chatId || (msg as any).chat_id || 'unknown',
                    userId: (msg as any).from?.id || 'unknown',
                    text: (msg as any).type === 'text' ? (msg as any).text : '',
                timestamp: new Date(),
                raw: msg,
                ...('location' in msg && {
                    location: {
                        latitude: (msg as any).location.latitude,
                        longitude: (msg as any).location.longitude,
                        live: (msg as any).live
                    }
                })
            };

            const tenantId = botConfig.core?.name;
            const handler = tenantId ? this.tenantHandlers.get(tenantId) : null;

            if (handler) await handler(context);
            else await this.handlers?.onMessage?.(context);
        });

        adapter.on('error', (e: Error) => this.handlers?.onError?.({ botId, error: e }));

        if (typeof (adapter as any).start === 'function') (adapter as any).start().catch(() => {});

        // Telegram polling: запускаем init в фоне, чтобы Orchestrator.start() не блокировал поток
        if (adapter instanceof TelegramBotPollingAdaptor) {
            (async () => {
                try {
                    await adapter.init();
                } catch (e) {
                    this.log('error', `Telegram adapter init failed for bot ${botId}`, e);
                }
            })();
        }
        // WhatsApp Web: client.initialize() в фоне (QR / сессия в sessionDir)
        if (adapter instanceof WhatsappWebPollingAdaptor) {
            (async () => {
                try {
                    await adapter.init();
                } catch (e) {
                    this.log('error', `WhatsApp adapter init failed for bot ${botId}`, e);
                }
            })();
        }
        this.log('info', `Bot ${botId} started`);
    }

    private createAdapter(botId: string, botConfig: BotConfig): IMessageAdapter {
        const transport = botConfig.transport;
        const type = transport.type;
        const noop = async () => {};

        if (type === 'telegram-bot-polling') {
            const token = (transport as any).token || '';
            return new TelegramBotPollingAdaptor(botId, token, noop, noop, noop, noop, noop);
        }
        if (type === 'telegram-bot-webhook') {
            const token = (transport as any).token || '';
            if(!transport.config) throw new Error(`No config provided for ${botId}`);
            return new TelegramBotWebhookAdaptor(botId, token, transport.config, noop, noop, noop, noop, noop);
        }
        if (type === 'whatsapp-web-polling') {
            const sessionDir = (transport as any).sessionDir || '.';
            return new WhatsappWebPollingAdaptor(botId, sessionDir, noop, noop, noop, noop, async () => {}, noop);
        }
        if (type === 'test') {
            const { TestAdapter } = require('../../transport/TestAdapter/TestAdapter');
            return new TestAdapter(botId);
        }
        throw new Error(`Unsupported type: ${type}`);
    }

    private getApiManagerForTenant(tenantId: string): APIManager | undefined {
        for (const botId of this.configManager.getBotIds()) {
            const bot = this.configManager.getBot(botId);
            if (bot?.core?.name === tenantId && bot.api) {
                return this.apiManagers.get(bot.api);
            }
        }
        return undefined;
    }

    getApiManagerForBot(botId: string): APIManager | undefined {
        const bot = this.configManager.getBot(botId);
        return bot?.api ? this.apiManagers.get(bot.api) : undefined;
    }

    getApiManager(apiId: string): APIManager | undefined {
        return this.apiManagers.get(apiId);
    }

    getAdapter(botId: string): IMessageAdapter | undefined {
        return this.bots.get(botId);
    }

    async sendMessage(botId: string, chatId: string, text: string): Promise<void> {
        const adapter = this.bots.get(botId) as any;
        if (adapter?.sendMessage) await adapter.sendMessage(chatId, text);
    }

    async stop(reason?: string) {
        this.log('warn', `Stopping: ${reason}`);
        for (const [, mgr] of this.apiManagers) {
            mgr.stopApiDataVersionWatch();
        }
        const taskManager = this.engine?.getTaskManager?.();
        if (taskManager?.stopWorker) {
            for (const tenantId of this.tenantHandlers.keys()) {
                taskManager.stopWorker(tenantId);
            }
        }
        for (const [, manager] of this.orderManagers) {
            manager.stop();
        }
        this.orderManagers.clear();
        this.driverSearchManagers.clear();
        for (const [, adapter] of this.bots) {
            if (typeof (adapter as any).stop === 'function') await (adapter as any).stop();
        }
        this.bots.clear();
        this.log('info', 'Stopped');
    }

    private log(level: string, msg: string, data?: any) {
        if (this.logger) {
            if (level === 'info') this.logger.info(`[Orch] ${msg}`, data);
            else if (level === 'error') this.logger.error(`[Orch] ${msg}`, data);
            else if (level === 'warn') this.logger.warn(`[Orch] ${msg}`, data);
        } else {
            if (level === 'error') defaultLogger.error(`[Orch] ${msg}`, data);
            else if (level === 'warn') defaultLogger.warn(`[Orch] ${msg}`, data);
            else defaultLogger.info(`[Orch] ${msg}`, data);
        }
    }
}

export { Orchestrator };