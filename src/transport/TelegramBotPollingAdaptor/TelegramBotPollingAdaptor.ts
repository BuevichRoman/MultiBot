import { Bot, Context, GrammyError, HttpError } from "grammy";
import {
    IMessageAdapter,
    AnyMessage,
    UserInfo,
    SendResult,
    EditResult,
    DeleteResult,
    Capabilities,
    Platform,
    createTextMessage,
    createLocationMessage,
    createUnsupportedMessage,
    AdapterError,
    ErrorCode,
    PlatformIcons
} from "../types";
import { getTaggedLogger } from "../../addons/logger";

const tgPollLog = getTaggedLogger("TelegramPolling");

/**
 * Расширенная версия с поддержкой вложенного форматирования
 * и дополнительных возможностей
 */
export function whatsappToHtmlSafe(text: string): string {
    if (!text) return text;

    let result = text;

    // Сначала обрабатываем комбинацию _*текст*_ (жирный курсив)
    // Ищем паттерн: _* текст *_
    // Флаг 'g' для глобального поиска, 's' для DOTALL (чтобы . включал \n)
    const patternItalicBold = /_\*(.*?)\*_/gs;
    result = result.replace(patternItalicBold, '<b><i>$1</i></b>');

    // Затем обрабатываем *текст* (жирный)
    const patternBold = /\*(.*?)\*/gs;
    result = result.replace(patternBold, '<b>$1</b>');

    // Затем обрабатываем _текст_ (курсив)
    // Но только если это не часть другого форматирования
    const patternItalic = /_(.*?)_/gs;
    result = result.replace(patternItalic, '<i>$1</i>');

    // Заменяем экранированные переносы строк
    result = result.replace(/\\n/g, '\n');

    return result;
}

// ==================== TELEGRAM АДАПТЕР ====================

class TelegramBotPollingAdaptor implements IMessageAdapter {
    private bot: Bot;
    public ID: string;
    private token: string;
    private messageHandler?: (message: AnyMessage) => void;
    private isRunning: boolean = false;

    readonly capabilities: Capabilities = {
        canEdit: true,
        canDelete: true,
        canPin: true,
        editTimeLimit: 48 * 60 * 60 * 1000, // 48 часов
        deleteForEveryone: true,
        maxMessageLength: 4096,
        supportsMarkdown: true,
        supportsHTML: true
    };

    // Опциональные колбэки
    private onStart?: () => Promise<any>;
    private onStop?: () => Promise<any>;
    private onReady?: () => Promise<any>;
    private onError?: (error: Error) => Promise<any>;

    constructor(
        ID: string,
        token: string,
        onStart: () => Promise<any>,
        onStop: () => Promise<any>,
        onMessage: (message: AnyMessage) => Promise<any>,
        onReady: () => Promise<any>,
        onError: (error: any) => Promise<any>
    ) {
        this.ID = ID;
        this.token = token;

        // Сохраняем колбэки
        this.onStart = onStart;
        this.onStop = onStop;
        this.onReady = onReady;
        this.onError = onError;

        // Создаем бота с переданным токеном
        this.bot = new Bot(token);

        // Настраиваем обработчики
        this.setupEventListeners(onMessage);

    }

    getPlatform(): Platform {
        return 'telegram';
    }

    private setupEventListeners(onMessage: (message: AnyMessage) => Promise<any>) {

        // Обработка всех сообщений
        this.bot.on("message", async (ctx: Context) => {
            try {
                // Трансформируем в AnyMessage
                const message = await this.transformMessage(ctx);

                // Вызываем оба обработчика для надежности
                if (this.messageHandler) {
                    await this.messageHandler(message);
                }

                await onMessage(message);

            } catch (error) {
                tgPollLog.error("Message processing error", { botId: this.ID, error });
                if (this.onError) await this.onError(error as Error);
            }
        });

        // Обработка callback query (кнопки)
        this.bot.on("callback_query:data", async (ctx: Context) => {
            try {
                // Для callback создаем отдельное сообщение
                const message = await this.transformCallback(ctx);
                if (message) {
                    if (this.messageHandler) {
                        await this.messageHandler(message);
                    }
                    await onMessage(message);
                }
            } catch (error) {
                tgPollLog.error("Callback processing error", { botId: this.ID, error });
                if (this.onError) await this.onError(error as Error);
            }
        });

        // Обработка ошибок бота
        this.bot.catch((err: any) => {
            const ctx = err.ctx;
            tgPollLog.error("Error while handling update", {
                botId: this.ID,
                updateId: ctx?.update?.update_id,
            });

            const e = err.error;
            if (e instanceof GrammyError) {
                tgPollLog.error("Grammy request error", { botId: this.ID, description: e.description });
                if (e.error_code === 401) {
                    tgPollLog.error("Invalid Telegram bot token (401)", { botId: this.ID });
                }
            } else if (e instanceof HttpError) {
                tgPollLog.error("Could not contact Telegram", { botId: this.ID, error: e });
            } else {
                tgPollLog.error("Unknown bot error", { botId: this.ID, error: e });
            }

            if (this.onError) this.onError(e);
        });
    }

    private async transformMessage(ctx: Context): Promise<AnyMessage> {
        const userInfo: UserInfo = {
            id: ctx.from?.id?.toString() || 'unknown',
            firstName: ctx.from?.first_name,
            lastName: ctx.from?.last_name,
            username: ctx.from?.username
        };

        const chatId = ctx.chat?.id?.toString() || 'unknown';
        const msg = ctx.message;
        const messageId = msg?.message_id?.toString() || Date.now().toString();
        const timestamp = (msg?.date || Math.floor(Date.now() / 1000)) * 1000;

        // 1. ЛОКАЦИЯ
        if (msg?.location) {
            return createLocationMessage(
                messageId,
                chatId,
                userInfo,
                timestamp,
                this.getPlatform(),
                msg.location.latitude.toString(),
                msg.location.longitude.toString(),
                false
            );
        }

        // 2. ТЕКСТ
        if (msg?.text) {
            return createTextMessage(
                messageId,
                chatId,
                userInfo,
                timestamp,
                this.getPlatform(),
                msg.text
            );
        }

        // 3. ВСЕ ОСТАЛЬНОЕ
        return createUnsupportedMessage(
            messageId,
            chatId,
            userInfo,
            timestamp,
            this.getPlatform(),
            this.getUnsupportedReason(ctx)
        );
    }

    private async transformCallback(ctx: Context): Promise<AnyMessage | null> {
        if (!ctx.callbackQuery) return null;

        const userInfo: UserInfo = {
            id: ctx.from?.id?.toString() || 'unknown',
            firstName: ctx.from?.first_name,
            lastName: ctx.from?.last_name,
            username: ctx.from?.username
        };

        const chatId = ctx.chat?.id?.toString() || 'unknown';
        const messageId = `callback_${Date.now()}`;
        const timestamp = Date.now();

        return {
            id: messageId,
            chatId,
            from: userInfo,
            timestamp,
            platform: this.getPlatform(),
            type: 'text',
            text: `/callback ${ctx.callbackQuery.data}`
        } as AnyMessage;
    }

    private getUnsupportedReason(ctx: Context): string {
        const msg = ctx.message;
        if (msg?.photo) return 'photo';
        if (msg?.video) return 'video';
        if (msg?.audio) return 'audio';
        if (msg?.document) return 'document';
        if (msg?.sticker) return 'sticker';
        if (msg?.voice) return 'voice';
        if (msg?.contact) return 'contact';
        if (msg?.poll) return 'poll';
        if (msg?.dice) return 'dice';
        return 'unknown';
    }

    async init() {
        try {
            tgPollLog.info("Initializing", { botId: this.ID, tokenPrefix: `${this.token.substring(0, 5)}...` });

            // Проверяем токен перед запуском
            await this.validateToken();

            if (this.onStart) await this.onStart();

            // Запускаем polling
            await this.bot.start({
                onStart: async () => {
                    this.isRunning = true;
                    tgPollLog.info("Started polling", { botId: this.ID });
                    if (this.onReady) await this.onReady();
                },
                drop_pending_updates: true
            });

        } catch (error) {
            this.isRunning = false;
            tgPollLog.error("Init error", { botId: this.ID, error });

            if (error instanceof GrammyError && error.error_code === 401) {
                tgPollLog.error("Invalid token — check BotFather / copy / revocation", {
                    botId: this.ID,
                });
            }

            if (this.onError) await this.onError(error as Error);
            throw error; // Пробрасываем ошибку дальше
        }
    }

    // Метод для проверки токена
    private async validateToken(): Promise<boolean> {
        try {
            const me = await this.bot.api.getMe();
            tgPollLog.info("Authorized", { botId: this.ID, username: me.username });
            return true;
        } catch (error) {
            throw error;
        }
    }

    async stop() {
        try {
            tgPollLog.info("Stopping", { botId: this.ID });
            this.isRunning = false;
            await this.bot.stop();
            if (this.onStop) await this.onStop();
        } catch (error) {
            tgPollLog.error("Stop error", { botId: this.ID, error });
        }
    }

    async sendMessage(chatId: string, text: string, options?: { replyTo?: string, toTelegramHtml:true }): Promise<SendResult> {
        try {
            if(options?.toTelegramHtml){
                text = whatsappToHtmlSafe(text)
            }
            text = whatsappToHtmlSafe(text)
            const result = await this.bot.api.sendMessage(
                parseInt(chatId),
                text,
                {
                    reply_parameters: options?.replyTo ? {
                        message_id: parseInt(options.replyTo)
                    } : undefined,
                    parse_mode: 'HTML'
                }
            );

            return {
                messageId: result.message_id.toString(),
                timestamp: Date.now()
            };
        } catch (error) {
            throw new AdapterError(
                'Failed to send message',
                this.getPlatform(),
                ErrorCode.SEND_FAILED,
                error
            );
        }
    }

    async sendLocation(chatId: string, lat: string, lng: string): Promise<SendResult> {
        try {
            const result = await this.bot.api.sendLocation(
                parseInt(chatId),
                parseFloat(lat),
                parseFloat(lng)
            );

            return {
                messageId: result.message_id.toString(),
                timestamp: Date.now()
            };
        } catch (error) {
            throw new AdapterError(
                'Failed to send location',
                this.getPlatform(),
                ErrorCode.SEND_FAILED,
                error
            );
        }
    }

    async sendAction(chatId: string, action: 'typing' | 'uploading'): Promise<void> {
        const actionMap = {
            typing: 'typing',
            uploading: 'upload_photo'
        } as const;

        await this.bot.api.sendChatAction(
            parseInt(chatId),
            actionMap[action]
        );
    }

    async editMessage(chatId: string, messageId: string, newText: string): Promise<EditResult> {
        try {
            newText = whatsappToHtmlSafe(newText);
            await this.bot.api.editMessageText(
                parseInt(chatId),
                parseInt(messageId),
                newText,
                { parse_mode: 'HTML' }
            );
            return {
                success: true,
                messageId,
                newText,
                timestamp: Date.now(),
                needsVerification: false
            };
        } catch (error) {
            return {
                success: false,
                messageId,
                newText,
                timestamp: Date.now()
            };
        }
    }

    async deleteMessage(messageId: string, forEveryone: boolean): Promise<DeleteResult> {
        try {
            return {
                success: true,
                messageId,
                forEveryone
            };
        } catch {
            return {
                success: false,
                messageId,
                forEveryone
            };
        }
    }

    on(event: 'message', handler: (message: AnyMessage) => void): void;
    on(event: 'ready', handler: () => void): void;
    on(event: 'error', handler: (error: Error) => void): void;
    on(event: 'qr', handler: (qr: string) => void): void;
    on(event: 'disconnected', handler: (reason: any) => void): void;
    on(event: string, handler: any): void {
        switch(event) {
            case 'message':
                this.messageHandler = handler;
                break;
        }
    }

    getStatus() {
        return {
            id: this.ID,
            ready: this.isRunning,
            platform: this.getPlatform(),
            icon: PlatformIcons.telegram,
            token_preview: this.token ? this.token.substring(0, 8) + '...' : 'none'
        };
    }
}

// Экспортируем только адаптер
export { TelegramBotPollingAdaptor };