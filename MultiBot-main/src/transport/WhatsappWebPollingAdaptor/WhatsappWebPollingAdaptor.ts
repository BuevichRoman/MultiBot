import { Client, LocalAuth, Message as WAWebJSMessage } from "whatsapp-web.js";
import qrcodeTerminal from "qrcode-terminal";
import {
    IMessageAdapter,
    AnyMessage,
    UserInfo,
    SendResult,
    EditResult,
    DeleteResult,
    Capabilities,
    Platform,
    isTextMessage,
    isLocationMessage,
    createTextMessage,
    createLocationMessage,
    createUnsupportedMessage,
    AdapterError,
    ErrorCode,
    PlatformIcons
} from "../types";
import { getTaggedLogger } from "../../addons/logger";

const waPollLog = getTaggedLogger("WhatsAppPolling");

function isWhatsappMessageDebug(): boolean {
    return process.env.WHATSAPP_DEBUG === "1";
}

// ==================== WHATSAPP АДАПТЕР ====================

class WhatsappWebPollingAdaptor implements IMessageAdapter {
    private client: Client;
    public ID: string;
    private transformer: WhatsAppTransformer;
    private messageHandler?: (message: AnyMessage) => void;

    readonly capabilities: Capabilities = {
        canEdit: true,
        canDelete: true,
        canPin: false,
        editTimeLimit: 15 * 60 * 1000, // ~15 минут
        deleteForEveryone: true,
        maxMessageLength: 65536,
        supportsMarkdown: false,
        supportsHTML: false
    };

    // Опциональные колбэки
    private onStart?: () => Promise<any>;
    private onStop?: () => Promise<any>;
    private onReady?: () => Promise<any>;
    private onSessionCancel?: (reason: any) => Promise<any>;
    private onError?: (error: Error) => Promise<any>;
    private onQr?: (qr: string) => Promise<any>;

    constructor(
        ID: string,
        session_dir: string,
        onStart: () => Promise<any>,
        onStop: () => Promise<any>,
        onMessage: (message: AnyMessage) => Promise<any>,
        onReady: () => Promise<any>,
        onSessionCancel: (reason: any) => Promise<any>,
        onError: (error: any) => Promise<any>,
        onQr?: (qr: string) => Promise<any>
    ) {
        this.ID = ID;
        this.transformer = new WhatsAppTransformer(this);

        // Сохраняем колбэки
        this.onStart = onStart;
        this.onStop = onStop;
        this.onReady = onReady;
        this.onSessionCancel = onSessionCancel;
        this.onError = onError;
        this.onQr = onQr;

        this.client = new Client({
            authStrategy: new LocalAuth({
                clientId: `bot-${ID}`,
                dataPath: `${session_dir}/bot-${ID}`,
            }),
            puppeteer: {
                headless: true,
                args: ["--no-sandbox"],
            },
        });

        this.setupEventListeners(onMessage);
    }

    getPlatform(): Platform {
        return 'whatsapp';
    }

    private setupEventListeners(onMessage: (message: AnyMessage) => Promise<any>) {
        // Ready
        this.client.on('ready', async () => {
            waPollLog.info("Ready", { botId: this.ID });
            if (this.onReady) await this.onReady();
        });

        // Error
        this.client.on('error', async (error) => {
            waPollLog.error("Client error", { botId: this.ID, error });
            if (this.onError) await this.onError(error);
        });

        // QR — всегда рисуем в терминале (Orchestrator передаёт onQr = noop)
        this.client.on('qr', async (qr: string) => {
            waPollLog.info("Scan QR with WhatsApp → Linked devices", { botId: this.ID });
            qrcodeTerminal.generate(qr, { small: true });
            if (this.onQr) await this.onQr(qr);
        });

        // Disconnected
        this.client.on('disconnected', async (reason) => {
            waPollLog.info("Disconnected", { botId: this.ID, reason });
            if (this.onSessionCancel) await this.onSessionCancel(reason);
        });

        // Message (Orchestrator вешает обработчик через adapter.on('message') → messageHandler)
        this.client.on('message', async (msg: WAWebJSMessage) => {
            if (isWhatsappMessageDebug()) {
                waPollLog.debug("[WA DEBUG] raw message", {
                    botId: this.ID,
                    id: msg.id?.id,
                    from: msg.from,
                    to: msg.to,
                    fromMe: msg.fromMe,
                    type: msg.type,
                    hasBody: !!msg.body,
                    bodyPreview:
                        typeof msg.body === "string" ? msg.body.slice(0, 120) : undefined,
                    hasMedia: msg.hasMedia,
                    hasLocation: !!msg.location,
                });
            }
            try {
                const message = await this.transformer.transformMessage(msg);
                if (isWhatsappMessageDebug()) {
                    waPollLog.debug("[WA DEBUG] transformed", {
                        botId: this.ID,
                        id: message.id,
                        chatId: (message as AnyMessage & { chatId?: string }).chatId,
                        type: message.type,
                        text:
                            message.type === "text"
                                ? String((message as { text?: string }).text ?? "").slice(0, 120)
                                : undefined,
                    });
                }
                const handler = this.messageHandler ?? onMessage;
                if (handler) {
                    await handler(message);
                    if (isWhatsappMessageDebug()) {
                        waPollLog.debug("[WA DEBUG] messageHandler finished", { botId: this.ID });
                    }
                } else if (isWhatsappMessageDebug()) {
                    waPollLog.warn("[WA DEBUG] no messageHandler and no ctor onMessage", { botId: this.ID });
                }
            } catch (error) {
                waPollLog.error("Message processing error", { botId: this.ID, error });
            }
        });
    }

    async init() {
        try {
            waPollLog.info("Initializing", { botId: this.ID });
            if (this.onStart) await this.onStart();
            await this.client.initialize();
        } catch (error) {
            waPollLog.error("Init error", { botId: this.ID, error });
            if (this.onError) await this.onError(error as Error);
        }
    }

    async stop() {
        try {
            waPollLog.info("Stopping", { botId: this.ID });
            await this.client.destroy();
            if (this.onStop) await this.onStop();
        } catch (error) {
            waPollLog.error("Stop error", { botId: this.ID, error });
        }
    }

    async sendMessage(chatId: string, text: string, options?: { replyTo?: string }): Promise<SendResult> {
        if (!this.client.info) {
            throw new AdapterError(
                'WhatsApp client not ready',
                this.getPlatform(),
                ErrorCode.NOT_READY
            );
        }

        try {
            let result;
            if (options?.replyTo) {
                // В WhatsApp нужно получить сообщение по ID для ответа
                // Это сложно, пока упрощаем
                result = await this.client.sendMessage(chatId, text);
            } else {
                result = await this.client.sendMessage(chatId, text);
            }

            const wid = result.id as { id?: string; _serialized?: string };
            return {
                messageId: wid._serialized || wid.id || '',
                timestamp: Date.now(),
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
        if (!this.client.info) {
            throw new AdapterError(
                'WhatsApp client not ready',
                this.getPlatform(),
                ErrorCode.NOT_READY
            );
        }

        try {
            const result = await this.client.sendMessage(chatId, `📍 ${lat}, ${lng}`);
            const wid = result.id as { id?: string; _serialized?: string };
            return {
                messageId: wid._serialized || wid.id || '',
                timestamp: Date.now(),
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
        if (!this.client.info) return;

        if (action === 'typing') {
            await this.client.sendPresenceAvailable();
        }
    }

    async editMessage(_chatId: string, messageId: string, newText: string): Promise<EditResult> {
        if (!this.capabilities.canEdit) {
            throw new AdapterError(
                'Editing not supported',
                this.getPlatform(),
                ErrorCode.NOT_SUPPORTED
            );
        }

        if (!this.client.info) {
            throw new AdapterError(
                'WhatsApp client not ready',
                this.getPlatform(),
                ErrorCode.NOT_READY
            );
        }

        try {
            const clientAny = this.client as Client & {
                getMessageById?: (id: string) => Promise<WAWebJSMessage | null>;
            };
            const getById = clientAny.getMessageById?.bind(this.client);
            if (!getById) {
                return {
                    success: false,
                    messageId,
                    newText,
                    timestamp: Date.now(),
                };
            }

            const msg = await getById(messageId);
            if (!msg) {
                if (isWhatsappMessageDebug()) {
                    waPollLog.warn("editMessage: getMessageById returned null", {
                        botId: this.ID,
                        messageId: messageId?.slice?.(0, 80),
                    });
                }
                return {
                    success: false,
                    messageId,
                    newText,
                    timestamp: Date.now(),
                };
            }

            const edited = await msg.edit(newText);
            return {
                success: !!edited,
                messageId,
                newText,
                timestamp: Date.now(),
            };
        } catch (error) {
            if (isWhatsappMessageDebug()) {
                waPollLog.error("editMessage error", { botId: this.ID, error });
            }
            return {
                success: false,
                messageId,
                newText,
                timestamp: Date.now(),
            };
        }
    }

    async deleteMessage(messageId: string, forEveryone: boolean): Promise<DeleteResult> {
        if (!this.capabilities.canDelete) {
            throw new AdapterError(
                'Deleting not supported',
                this.getPlatform(),
                ErrorCode.NOT_SUPPORTED
            );
        }

        try {
            // Аналогично, нужен объект Message
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
            case 'ready':
                // Уже обрабатывается в конструкторе
                break;
            case 'error':
                // Уже обрабатывается в конструкторе
                break;
            case 'qr':
                // Уже обрабатывается в конструкторе
                break;
            case 'disconnected':
                // Уже обрабатывается в конструкторе
                break;
        }
    }

    getStatus() {
        return {
            id: this.ID,
            ready: this.client.info ? true : false,
            platform: this.getPlatform(),
            icon: PlatformIcons.whatsapp
        };
    }
}

// ==================== WHATSAPP ТРАНСФОРМЕР ====================

class WhatsAppTransformer {
    constructor(private adapter: IMessageAdapter) {}

    async transformMessage(message: WAWebJSMessage): Promise<AnyMessage> {
        const userInfo = await this.extractUserInfo(message);
        const platform = this.adapter.getPlatform();

        // 1. ЛОКАЦИЯ
        if (message.location) {
            return createLocationMessage(
                message.id.id,
                message.from,
                userInfo,
                message.timestamp * 1000,
                platform,
                message.location.latitude.toString(),
                message.location.longitude.toString(),
                false
            );
        }

        // 2. ТЕКСТ
        if (message.body) {
            return createTextMessage(
                message.id.id,
                message.from,
                userInfo,
                message.timestamp * 1000,
                platform,
                message.body
            );
        }

        // 3. ВСЕ ОСТАЛЬНОЕ
        return createUnsupportedMessage(
            message.id.id,
            message.from,
            userInfo,
            message.timestamp * 1000,
            platform,
            this.getUnsupportedReason(message)
        );
    }

    private async extractUserInfo(message: WAWebJSMessage): Promise<UserInfo> {
        const userId = message.from.split('@')[0];

        const userInfo: UserInfo = {
            id: userId,
            phoneNumber: userId
        };

        try {
            const contact = await message.getContact();
            if (contact) {
                userInfo.firstName = contact.pushname || contact.name;
                userInfo.username = contact.id?.user;
            }
        } catch {
            // Игнорируем ошибки
        }

        return userInfo;
    }

    private getUnsupportedReason(message: WAWebJSMessage): string {
        if (message.hasMedia) return 'media';
        if (message.vCards?.length) return 'contact';

        const type = message.type;
        if (type === 'sticker') return 'sticker';
        if (type === 'ptt') return 'voice';

        return 'unknown';
    }
}

// Экспортируем только адаптер, трансформер остается внутренним
export { WhatsappWebPollingAdaptor };