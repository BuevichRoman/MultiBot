/**
 * Время ожидания снимает только заказ, который ещё ищет няню.
 * Принятый няней заказ не отменяется, сколько бы он ни висел на наблюдении
 * (заказ 4154: снят через 10 минут, когда няня уже была на месте).
 *
 * Запуск: ./node_modules/.bin/ts-node -T tests/test_watch_timeout.ts
 */
import assert from 'assert';
import { OrderManager } from '../src/newManagers/OrderManager/OrderManager';
import { ORDER_STATUS_EVENTS } from '../src/newManagers/OrderManager/types';

const ELEVEN_MIN = 11 * 60 * 1000;

async function run(data: any, lastEmittedEvent?: string) {
  const canceled: string[] = [];
  const events: string[] = [];
  const mgr = new OrderManager('children', {
    getOrderState: async () => data,
    cancelOrder: async (_id, reason) => { canceled.push(reason); },
    onSystemEvent: async (p: any) => { events.push(p.event ?? p.eventName ?? p.type); },
  });
  mgr.registerOrder('1', { botId: 'b', chatId: 'c', idField: { u_a_tg: 'c' } } as any);
  const entry = (mgr as any).activeOrders.get('1');
  entry.registeredAt = Date.now() - ELEVEN_MIN;
  entry.lastEmittedEvent = lastEmittedEvent;
  await (mgr as any).tick();
  return { canceled, events, watching: (mgr as any).activeOrders.has('1') };
}

const nanny = (extra: any) => ({ u_id: '901', c_appointed: '2026-10-04 23:52:00+03:00', c_canceled: null, ...extra });

async function main() {
  // --- 1. Ищет няню 11 минут — отменяем, как и раньше ---
  {
    const r = await run({ b_state: '1', drivers: [] });
    assert.strictEqual(r.canceled.length, 1);
    assert.strictEqual(r.watching, false);
    console.log('✅ Test 1: заказ без няни снимается по таймауту');
  }

  // --- 2. Няня приняла — не отменяем ---
  {
    const r = await run({ b_state: '2', drivers: [nanny({})] });
    assert.deepStrictEqual(r.canceled, []);
    assert.strictEqual(r.watching, true);
    console.log('✅ Test 2: принятый няней заказ не снимается');
  }

  // --- 3. Няня на месте (как 4154) — не отменяем ---
  {
    const r = await run({ b_state: '2', drivers: [nanny({ c_arrived: '2026-10-04 23:54:00+03:00' })] });
    assert.deepStrictEqual(r.canceled, []);
    console.log('✅ Test 3: няня прибыла — заказ живёт');
  }

  // --- 4. Няня работает, а время начала + лист ожидания давно прошли ---
  {
    const r = await run({
      b_state: '2',
      b_start_datetime: '2026-10-05 12:00:00+03:00',
      b_max_waiting_list: '{"1":"5"}',
      drivers: [nanny({ c_arrived: '2026-10-05 11:55:00+03:00', c_started: '2026-10-05 12:00:00+03:00' })],
    });
    assert.deepStrictEqual(r.canceled, []);
    console.log('✅ Test 4: работающую няню таймаут не прерывает');
  }

  // --- 5. API не ответил, няни ещё не было — отменяем, как и раньше ---
  {
    const r = await run(null);
    assert.deepStrictEqual(r.canceled, ['Max waiting time exceeded']);
    console.log('✅ Test 5: без ответа API ищущий заказ снимается');
  }

  // --- 6. API не ответил, но няня уже принимала — не отменяем ---
  {
    const r = await run(null, ORDER_STATUS_EVENTS.APPROVED);
    assert.deepStrictEqual(r.canceled, []);
    assert.strictEqual(r.watching, true);
    console.log('✅ Test 6: сбой API не снимает принятый заказ');
  }

  console.log('\nВсе тесты пройдены');
}

main().catch((e) => { console.error(e); process.exit(1); });
