// Simple test runner for TelegramBotWebhookAdaptor (manual).
import { TelegramBotWebhookAdaptor } from './TelegramBotWebhookAdaptor';
import { AnyMessage } from '../types';

const handler = async (msg: AnyMessage) => {
  console.log('Received message via webhook:', msg);
};

const adaptor = new TelegramBotWebhookAdaptor(
  'test_bot',
  process.env.TG_TOKEN || '7806336871:AAH8NV7D32IcD97whIoStEHowKMzl9JcHyU',
  { platform: 'telegram', botId: 'test_bot', webhookUrl: process.env.WEBHOOK_BASE || 'https://example.com', port: Number(process.env.WEBHOOK_PORT || 3000) },
  async () => console.log('start'),
  async () => console.log('stop'),
  handler,
  async () => console.log('ready'),
  async (e) => console.error('error', e)
);

adaptor.init().catch(console.error);
