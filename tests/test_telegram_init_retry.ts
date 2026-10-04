/**
 * Telegram polling поднимается сам после ошибки запуска (таймаут, 409),
 * а не молчит до ручного рестарта.
 *
 * Запуск: ./node_modules/.bin/ts-node -T tests/test_telegram_init_retry.ts
 */
import assert from 'assert';
import { runWithRetry, TELEGRAM_RETRY_DELAYS_MS } from '../src/newManagers/orchestrator/retry';
import { TelegramBotPollingAdaptor } from '../src/transport';

const noop = async () => {};

async function main() {
  // --- 1. Паузы нарастают и упираются в последнюю ---
  {
    let calls = 0;
    const slept: number[] = [];
    await runWithRetry(async () => {
      if (++calls < 7) throw new Error('ETIMEDOUT');
    }, {
      delaysMs: TELEGRAM_RETRY_DELAYS_MS,
      shouldStop: () => false,
      onError: () => {},
      sleep: async (ms) => { slept.push(ms); },
    });
    assert.strictEqual(calls, 7);
    assert.deepStrictEqual(slept, [5000, 15000, 30000, 60000, 60000, 60000]);
    console.log('✅ Test 1: паузы 5/15/30/60 с, дальше раз в минуту');
  }

  // --- 2. Остановка прерывает повторы ---
  {
    let calls = 0;
    let stopping = false;
    await runWithRetry(async () => {
      calls++;
      stopping = true;
      throw new Error('ETIMEDOUT');
    }, {
      delaysMs: [1],
      shouldStop: () => stopping,
      onError: () => assert.fail('после остановки ошибка не логируется'),
      sleep: async () => {},
    });
    assert.strictEqual(calls, 1);
    console.log('✅ Test 2: при остановке повторов нет');
  }

  // --- 3. Настоящий адаптер grammY: таймаут getMe, затем 409, затем сообщение доходит ---
  {
    const adapter = new TelegramBotPollingAdaptor('test-bot', '123:fake', noop, noop, noop, noop, noop);
    const bot = (adapter as any).bot;
    let getMeCalls = 0;
    let getUpdatesCalls = 0;

    bot.api.config.use(async (_prev: any, method: string, _payload: any, signal?: AbortSignal) => {
      if (method === 'getMe') {
        if (++getMeCalls === 1) throw new Error('request to https://api.telegram.org/getMe failed, reason: ETIMEDOUT');
        return { ok: true, result: { id: 1, is_bot: true, first_name: 'Nanny', username: 'nanny_test_bot' } };
      }
      if (method === 'deleteWebhook') return { ok: true, result: true };
      if (method === 'getUpdates') {
        getUpdatesCalls++;
        if (getUpdatesCalls === 1) {
          return { ok: false, error_code: 409, description: 'Conflict: terminated by other getUpdates request' };
        }
        if (getUpdatesCalls === 2) {
          return {
            ok: true,
            result: [{
              update_id: 10,
              message: {
                message_id: 5, date: 1790000000, text: '0',
                chat: { id: 42, type: 'private' }, from: { id: 42, is_bot: false, first_name: 'Client' },
              },
            }],
          };
        }
        // Дальше — пустой long polling до остановки
        await new Promise((r) => { setTimeout(r, 50); signal?.addEventListener('abort', r); });
        return { ok: true, result: [] };
      }
      return { ok: true, result: true };
    });

    const received: string[] = [];
    adapter.on('message', (m: any) => { received.push(m.text); });

    const errors: number[] = [];
    let stopping = false;
    const running = runWithRetry(() => adapter.init(), {
      delaysMs: [10],
      shouldStop: () => stopping,
      onError: (_e, attempt) => errors.push(attempt),
    });

    for (let i = 0; i < 100 && received.length === 0; i++) await new Promise((r) => setTimeout(r, 20));
    assert.deepStrictEqual(received, ['0'], 'сообщение дошло после двух неудачных запусков');
    assert.deepStrictEqual(errors, [1, 2], 'две ошибки: таймаут и 409');

    stopping = true;
    await adapter.stop();
    await running;
    console.log('✅ Test 3: после таймаута и 409 бот поднялся и принял сообщение');
  }

  console.log('\nВсе тесты прошли');
}

main().catch((e) => { console.error(e); process.exit(1); });
