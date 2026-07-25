import {
    IMessageAdapter,
    AnyMessage,
    SendResult,
    DefaultCapabilities,
    Platform,
    PlatformIcons
} from '../types';

/**
 * Простой тестовый адаптер. Не общается с внешними сервисами — хранит отправленные сообщения
 * и возвращает структурированный результат через событие 'sent' и `getLastSent()`.
 */
export class TestAdapter implements IMessageAdapter {
    public ID: string;
    readonly capabilities = { ...DefaultCapabilities };
    private handlers: { [k: string]: any } = {};
    private lastSent: any = null;
    private templateParams: Record<string,string> = {};

    constructor(ID: string) {
        this.ID = ID;
    }

    getPlatform(): Platform {
        return 'test';
    }

    async init(): Promise<void> {
        // no-op
        return;
    }

    async start(): Promise<void> {
        // no-op
        if (this.handlers['ready']) this.handlers['ready']();
    }

    async stop(): Promise<void> {
        // no-op
        if (this.handlers['disconnected']) this.handlers['disconnected']('stopped');
    }

    /**
     * SendMessage for tests. Supports `options.params` — a map of key->value.
     * It will replace all occurrences of key in the original text with value.
     * Emits internal 'sent' event with structured result for assertions.
     */
    async sendMessage(chatId: string, text: string, options?: { replyTo?: string; params?: Record<string,string> }): Promise<SendResult> {
        const originalText = text;
        let finalText = String(text);
        const params = options?.params || this.templateParams || {};

        for (const [k, v] of Object.entries(params)) {
            try {
                finalText = finalText.split(k).join(String(v));
            } catch (e) {
                // ignore
            }
        }

        const result = {
            originalText,
            finalText,
            params,
            chatId,
            replyTo: options?.replyTo
        };

        // store last sent for test assertions
        this.lastSent = result;

        // emit 'sent' event if listener exists
        if (this.handlers['sent']) {
            try { this.handlers['sent'](result); } catch (e) {}
        }

        // return SendResult-compatible object
        return {
            messageId: (Date.now()).toString(),
            timestamp: Date.now()
        } as SendResult;
    }

    /**
     * Set template params used when `sendMessage` is called without explicit params.
     */
    public setTemplateParams(params: Record<string,string>) {
        this.templateParams = params || {};
    }

    /**
     * Get current template params
     */
    public getTemplateParams(): Record<string,string> {
        return this.templateParams;
    }

    async sendLocation(chatId: string, lat: string, lng: string): Promise<SendResult> {
        return { messageId: Date.now().toString(), timestamp: Date.now() } as SendResult;
    }

    async sendAction(chatId: string, action: 'typing' | 'uploading'): Promise<void> {
        return;
    }

    async editMessage(_chatId: string, messageId: string, newText: string): Promise<{ success: boolean; messageId: string; newText: string; timestamp: number }> {
        this.lastSent = { ...this.lastSent, edited: true, messageId, newText };
        return { success: true, messageId, newText, timestamp: Date.now() };
    }

    on(event: 'message'|'ready'|'error'|'qr'|'disconnected'|'sent', handler: any): void {
        this.handlers[event] = handler;
    }

    /**
     * Helper for tests: inject an incoming message into the adapter's message handler
     */
    public async receiveMessage(msg: AnyMessage): Promise<void> {
        const h = this.handlers['message'];
        if (h) {
            try { await h(msg); } catch (e) { if (this.handlers['error']) try { this.handlers['error'](e); } catch(_) {} }
        }
    }


    // helper for tests
    getLastSent() {
        return this.lastSent;
    }
}

export default TestAdapter;
