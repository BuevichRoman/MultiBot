// Public module entry for `src/transport` — реэкспорт основных сущностей
export { Message } from './Message';
export * from './types';
export { WhatsappWebPollingAdaptor } from './WhatsappWebPollingAdaptor/WhatsappWebPollingAdaptor';
export { TelegramBotPollingAdaptor } from './TelegramBotPollingAdaptor/TelegramBotPollingAdaptor';
export { TelegramBotWebhookAdaptor } from './TelegramBotWebhookAdaptor/TelegramBotWebhookAdaptor';
