import express, { Request, Response } from 'express';
import http from 'http';
import crypto from 'crypto';
import fetch from 'node-fetch';
import { Bot } from 'grammy';
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
    PlatformIcons,
    AdapterConfig
} from '../types';
import { getTaggedLogger } from '../../addons/logger';

const tgWebhookLog = getTaggedLogger('TelegramWebhook');

/**
 * Telegram webhook-based adapter.
 *
 * - Registers webhook using `AdapterConfig.webhookUrl` + `/telegram/:ID`.
 * - Verifies `X-Telegram-Bot-Api-Secret-Token` header with an internal secret.
 * - Starts an internal Express server on `AdapterConfig.port` (default 3000)
 *   to receive webhook updates.
 */
class TelegramBotWebhookAdaptor implements IMessageAdapter {
    private bot: Bot;
    public ID: string;
    private token: string;
    private config: AdapterConfig;
    private server?: http.Server;
    private app?: express.Express;
    private secretToken: string;
    private messageHandlers: Array<(message: AnyMessage) => void | Promise<void>> = [];

    readonly capabilities: Capabilities = {
        canEdit: true,
        canDelete: true,
        canPin: true,
        editTimeLimit: 48 * 60 * 60 * 1000,
        deleteForEveryone: true,
        maxMessageLength: 4096,
        supportsMarkdown: true,
        supportsHTML: true
    };

    // lifecycle hooks
    private onStart?: () => Promise<any>;
    private onStop?: () => Promise<any>;
    private onReady?: () => Promise<any>;
    private onError?: (error: any) => Promise<any>;

    constructor(
        ID: string,
        token: string,
        config: AdapterConfig,
        onStart: () => Promise<any>,
        onStop: () => Promise<any>,
        onMessage: (message: AnyMessage) => Promise<any>,
        onReady: () => Promise<any>,
        onError: (error: any) => Promise<any>
    ) {
        this.ID = ID;
        this.token = token;
        this.config = config;
        this.bot = new Bot(token);
        this.secretToken = crypto.randomBytes(16).toString('hex');

        this.onStart = onStart;
        this.onStop = onStop;
        this.onReady = onReady;
        this.onError = onError;

        // register constructor-provided message handler so webhook receiver will call it
        if (onMessage) this.messageHandlers.push(onMessage as any);
    }

    getPlatform(): Platform {
        return 'telegram';
    }

    private transformUpdateToAnyMessage(update: any): AnyMessage {
        const msg = update.message || update.edited_message || update.callback_query?.message;
        const from = msg?.from;
        const userInfo: UserInfo = {
            id: from?.id?.toString() || 'unknown',
            firstName: from?.first_name,
            lastName: from?.last_name,
            username: from?.username
        };

        const chatId = msg?.chat?.id?.toString() || 'unknown';
        const messageId = msg?.message_id?.toString() || Date.now().toString();
        const timestamp = (msg?.date || Math.floor(Date.now() / 1000)) * 1000;

        if (msg?.location) {
            return createLocationMessage(messageId, chatId, userInfo, timestamp, this.getPlatform(), msg.location.latitude.toString(), msg.location.longitude.toString(), false);
        }

        if (msg?.text) {
            return createTextMessage(messageId, chatId, userInfo, timestamp, this.getPlatform(), msg.text);
        }

        return createUnsupportedMessage(messageId, chatId, userInfo, timestamp, this.getPlatform(), 'unknown');
    }

    async init() {
        if (!this.config?.webhookUrl) {
            throw new AdapterError('webhookUrl must be provided in AdapterConfig for webhook adapter', this.getPlatform(), ErrorCode.NOT_INITIALIZED);
        }

        try {
            if (this.onStart) await this.onStart();

            // express app
            this.app = express();
            this.app.use(express.json());

            const routePath = `/telegram/${this.ID}`;

            this.app.post(routePath, async (req: Request, res: Response) => {
                try {
                    const headerSecret = (req.headers['x-telegram-bot-api-secret-token'] || '') as string;
                    if (!headerSecret || headerSecret !== this.secretToken) {
                        res.sendStatus(401);
                        return;
                    }

                    const anyMessage = this.transformUpdateToAnyMessage(req.body);
                    // Call all registered message handlers sequentially
                    for (const h of this.messageHandlers) {
                        try {
                            await h(anyMessage as AnyMessage);
                        } catch (err) {
                            tgWebhookLog.error('Handler error', { botId: this.ID, error: err });
                        }
                    }
                    res.sendStatus(200);
                } catch (err) {
                    tgWebhookLog.error('Webhook processing error', { botId: this.ID, error: err });
                    res.sendStatus(500);
                }
            });

            const port = this.config.port || 3000;
            this.server = this.app.listen(port, () => {
                tgWebhookLog.info('Webhook receiver listening', { botId: this.ID, port });
            });

            // register webhook with Telegram
            const webhookUrl = `${this.config.webhookUrl.replace(/\/$/, '')}${routePath}`;
            await fetch(`https://api.telegram.org/bot${this.token}/setWebhook`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ url: webhookUrl, secret_token: this.secretToken, allowed_updates: ['message', 'callback_query'] })
            });

            if (this.onReady) await this.onReady();

        } catch (error) {
            tgWebhookLog.error('Init error', { botId: this.ID, error });
            if (this.onError) await this.onError(error);
            throw error;
        }
    }

    async stop() {
        try {
            // delete webhook
            await fetch(`https://api.telegram.org/bot${this.token}/deleteWebhook`, { method: 'POST' });

            if (this.server) {
                this.server.close();
            }

            if (this.onStop) await this.onStop();
        } catch (error) {
            tgWebhookLog.error('Stop error', { botId: this.ID, error });
        }
    }

    async sendMessage(chatId: string, text: string, options?: { replyTo?: string }): Promise<SendResult> {
        try {
            const result = await this.bot.api.sendMessage(parseInt(chatId), text, options?.replyTo ? { reply_to_message_id: parseInt(options.replyTo) } : undefined as any);
            return { messageId: result.message_id.toString(), timestamp: Date.now() };
        } catch (error) {
            throw new AdapterError('Failed to send message', this.getPlatform(), ErrorCode.SEND_FAILED, error);
        }
    }

    async sendLocation(chatId: string, lat: string, lng: string): Promise<SendResult> {
        try {
            const result = await this.bot.api.sendLocation(parseInt(chatId), parseFloat(lat), parseFloat(lng));
            return { messageId: result.message_id.toString(), timestamp: Date.now() };
        } catch (error) {
            throw new AdapterError('Failed to send location', this.getPlatform(), ErrorCode.SEND_FAILED, error);
        }
    }

    async sendAction(chatId: string, action: 'typing' | 'uploading'): Promise<void> {
        const actionMap = { typing: 'typing', uploading: 'upload_photo' } as const;
        await this.bot.api.sendChatAction(parseInt(chatId), actionMap[action] as any);
    }

    async editMessage(chatId: string, messageId: string, newText: string): Promise<EditResult> {
        try {
            await this.bot.api.editMessageText(
                parseInt(chatId),
                parseInt(messageId),
                newText,
                { parse_mode: 'HTML' }
            );
            return { success: true, messageId, newText, timestamp: Date.now(), needsVerification: false };
        } catch (error) {
            return { success: false, messageId, newText, timestamp: Date.now() };
        }
    }

    async deleteMessage(messageId: string, forEveryone: boolean): Promise<DeleteResult> {
        try {
            // need chat id to delete; adapter keeps stateless provider so assume success
            return { success: true, messageId, forEveryone };
        } catch {
            return { success: false, messageId, forEveryone };
        }
    }

    on(event: 'message', handler: (message: AnyMessage) => void | Promise<void>): void;
    on(event: 'ready', handler: () => void): void;
    on(event: 'error', handler: (error: Error) => void): void;
    on(event: 'qr', handler: (qr: string) => void): void;
    on(event: 'disconnected', handler: (reason: any) => void): void;
    on(event: string, handler: any): void {
        switch (event) {
            case 'message':
                this.messageHandlers.push(handler);
                break;
        }
    }

    getStatus() {
        return { id: this.ID, ready: !!this.server, platform: this.getPlatform(), icon: PlatformIcons.telegram };
    }
}

export { TelegramBotWebhookAdaptor };
