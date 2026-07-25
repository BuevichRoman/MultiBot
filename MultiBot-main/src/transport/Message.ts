import { IMessageAdapter, UserInfo, Platform } from './types';
import { getTaggedLogger } from '../addons/logger';

const msgLog = getTaggedLogger('Message');

/**
 * Unified Message wrapper used across adapters and application logic.
 *
 * Holds base metadata (id, chatId, from, timestamp, platform) and
 * typed content (text, location or unsupported). Provides convenience
 * helpers to reply/edit/delete messages via the underlying adapter.
 */
export class Message {
    public readonly id: string;
    public readonly chatId: string;
    public readonly from: UserInfo;
    public readonly timestamp: number;
    public readonly platform: Platform;
    private readonly adapter: IMessageAdapter;

    private contentType: 'text' | 'location' | 'unsupported';
    private textContent?: string;
    private locationContent?: { latitude: string; longitude: string; live?: boolean };
    private unsupportedReason?: string;

    constructor(
        base: { id: string; chatId: string; from: UserInfo; timestamp: number; platform: Platform; adapter: IMessageAdapter },
        contentType: 'text' | 'location' | 'unsupported',
        content: any
    ) {
        this.id = base.id;
        this.chatId = base.chatId;
        this.from = base.from;
        this.timestamp = base.timestamp;
        this.platform = base.platform;
        this.adapter = base.adapter;

        this.contentType = contentType;

        switch(contentType) {
            case 'text':
                this.textContent = content.text;
                break;
            case 'location':
                this.locationContent = content.location;
                break;
            case 'unsupported':
                this.unsupportedReason = content.reason;
                break;
        }
    }

    /** Возвращает дискриминатор типа содержимого ('text'|'location'|'unsupported') */
    getType(): string {
        return this.contentType;
    }

    /** True если сообщение текстовое */
    isText(): boolean {
        return this.contentType === 'text';
    }

    /** True если сообщение содержит геолокацию */
    isLocation(): boolean {
        return this.contentType === 'location';
    }

    /** True если сообщение имеет неподдерживаемый тип */
    isUnsupported(): boolean {
        return this.contentType === 'unsupported';
    }

    /** Получить текст сообщения. Бросает ошибку если тип не 'text'. */
    getText(): string {
        if (!this.isText()) throw new Error('Message is not text');
        return this.textContent!;
    }

    /** Получить координаты (если тип 'location'). */
    getLocation(): { latitude: string; longitude: string; live?: boolean } {
        if (!this.isLocation()) throw new Error('Message is not location');
        return this.locationContent!;
    }

    /** Получить причину неподдерживаемого типа сообщения. */
    getUnsupportedReason(): string {
        if (!this.isUnsupported()) throw new Error('Message is not unsupported');
        return this.unsupportedReason!;
    }

    /** Ответить на это сообщение текстом. Возвращает новый `Message` для отправленного сообщения. */
    async reply(text: string): Promise<Message> {
        const result = await this.adapter.sendMessage(this.chatId, text, {
            replyTo: this.id
        });

        return new Message(
            {
                id: result.messageId,
                chatId: this.chatId,
                from: this.from,
                timestamp: Date.now(),
                platform: this.platform,
                adapter: this.adapter
            },
            'text',
            { text }
        );
    }

    /** Редактировать сообщение (если платформа поддерживает). Возвращает успех операции. */
    async edit(newText: string): Promise<boolean> {
        if (!this.adapter.capabilities.canEdit) {
            msgLog.debug('Edit not supported', { platform: this.platform });
            return false;
        }

        try {
            const result = await this.adapter.editMessage!(this.chatId, this.id, newText);

            if (result.success && this.isText()) {
                this.textContent = newText;
            }

            return result.success;
        } catch (error) {
            msgLog.error('Edit failed', { platform: this.platform, error });
            return false;
        }
    }

    /** Удалить сообщение. `forEveryone` учитывается если платформа поддерживает. */
    async delete(forEveryone: boolean = true): Promise<boolean> {
        if (!this.adapter.capabilities.canDelete) {
            msgLog.debug('Delete not supported', { platform: this.platform });
            return false;
        }

        try {
            await this.adapter.deleteMessage!(this.id, forEveryone);
            return true;
        } catch (error) {
            msgLog.error('Delete failed', { platform: this.platform, error });
            return false;
        }
    }

    /** Ответить локацией; возвращает `Message` созданной локации. */
    async replyWithLocation(lat: string, lng: string): Promise<Message> {
        const result = await this.adapter.sendLocation(this.chatId, lat, lng);

        return new Message(
            {
                id: result.messageId,
                chatId: this.chatId,
                from: this.from,
                timestamp: Date.now(),
                platform: this.platform,
                adapter: this.adapter
            },
            'location',
            { location: { latitude: lat, longitude: lng, live: false } }
        );
    }

    /** Показать индикатор ввода (typing). */
    async sendTyping(): Promise<void> {
        await this.adapter.sendAction(this.chatId, 'typing');
    }

    /** Сериализация в JSON-friendly объект. */
    toJSON() {
        return {
            id: this.id,
            chatId: this.chatId,
            from: this.from,
            timestamp: this.timestamp,
            platform: this.platform,
            type: this.contentType,
            content: this.isText() ? { text: this.textContent } :
                this.isLocation() ? { location: this.locationContent } :
                    { reason: this.unsupportedReason }
        };
    }

    /** Утилита: создать `Message` с типом 'text' из низкоуровневых данных. */
    static createText(
        adapter: IMessageAdapter,
        id: string,
        chatId: string,
        from: UserInfo,
        timestamp: number,
        text: string
    ): Message {
        return new Message(
            { id, chatId, from, timestamp, platform: adapter.getPlatform(), adapter },
            'text',
            { text }
        );
    }

    /** Создает сообщение с геолокацией */
    static createLocation(
        adapter: IMessageAdapter,
        id: string,
        chatId: string,
        from: UserInfo,
        timestamp: number,
        latitude: string,
        longitude: string,
        live?: boolean
    ): Message {
        return new Message(
            { id, chatId, from, timestamp, platform: adapter.getPlatform(), adapter },
            'location',
            { location: { latitude, longitude, live } }
        );
    }

    /** Создает сообщение о неподдерживаемом типе */
    static createUnsupported(
        adapter: IMessageAdapter,
        id: string,
        chatId: string,
        from: UserInfo,
        timestamp: number,
        reason: string
    ): Message {
        return new Message(
            { id, chatId, from, timestamp, platform: adapter.getPlatform(), adapter },
            'unsupported',
            { reason }
        );
    }
}