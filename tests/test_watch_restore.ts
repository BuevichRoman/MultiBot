/**
 * Наблюдение за заказами переживает рестарт процесса: новый OrderManager
 * подхватывает заказы из store и продолжает с того же места.
 *
 * Запуск: ./node_modules/.bin/ts-node -T tests/test_watch_restore.ts
 */
import assert from 'assert';
import { OrderManager, redisWatchStore, ORDER_STATUS_EVENTS } from '../src/newManagers/OrderManager';

const ELEVEN_MIN = 11 * 60 * 1000;

/** Хеш Redis в памяти — то, что нужно redisWatchStore */
function fakeRedis() {
  const h = new Map<string, Map<string, string>>();
  const get = (k: string) => h.get(k) ?? h.set(k, new Map()).get(k)!;
  return {
    async hset(k: string, f: string, v: string) { get(k).set(f, v); return 1; },
    async hdel(k: string, f: string) { return get(k).delete(f) ? 1 : 0; },
    async hgetall(k: string) { return Object.fromEntries(get(k)); },
  } as any;
}

function manager(store: any, data: any) {
  const events: string[] = [];
  const canceled: string[] = [];
  const mgr = new OrderManager('children', {
    getOrderState: async () => data,
    cancelOrder: async (_id, reason) => { canceled.push(reason); },
    onSystemEvent: async (p) => { events.push(p.event); },
    store,
  });
  return { mgr, events, canceled, tick: () => (mgr as any).tick() };
}

const approved = { b_state: '2', drivers: [{ u_id: '901', c_appointed: '2026-10-10 10:00:00+03:00', c_canceled: null }] };

async function main() {
  // --- 1. Заказ из прошлого процесса снова под наблюдением, уведомление не повторяется ---
  {
    const store = redisWatchStore(fakeRedis(), 'children');
    const before = manager(store, approved);
    before.mgr.registerOrder('1', { orderId: '1', botId: 'b', chatId: 'c', idField: { u_a_tg: 'c' } });
    await before.tick();
    assert.deepStrictEqual(before.events, [ORDER_STATUS_EVENTS.APPROVED]);

    const after = manager(store, approved);
    await after.mgr.restore();
    assert.deepStrictEqual(after.mgr.getActiveOrderIds(), ['1']);
    await after.tick();
    assert.deepStrictEqual(after.events, [], 'APPROVED уже отправлен прошлым процессом');
    console.log('✅ Test 1: заказ подхвачен, повторного уведомления нет');
  }

  // --- 2. Новый статус после рестарта доходит до клиента ---
  {
    const store = redisWatchStore(fakeRedis(), 'children');
    const before = manager(store, approved);
    before.mgr.registerOrder('2', { orderId: '2', botId: 'b', chatId: 'c' });
    await before.tick();

    const arrived = { b_state: '2', drivers: [{ ...approved.drivers[0], c_arrived: '2026-10-10 10:20:00+03:00' }] };
    const after = manager(store, arrived);
    await after.mgr.restore();
    await after.tick();
    assert.deepStrictEqual(after.events, [ORDER_STATUS_EVENTS.DRIVER_ARRIVED]);
    console.log('✅ Test 2: «няня прибыла» после рестарта отправлено');
  }

  // --- 3. Таймаут не начинается заново ---
  {
    const store = redisWatchStore(fakeRedis(), 'children');
    const before = manager(store, { b_state: '1', drivers: [] });
    before.mgr.registerOrder('3', { orderId: '3', botId: 'b', chatId: 'c' });
    const entry = before.mgr.getOrderDetails('3')!;
    entry.registeredAt = Date.now() - ELEVEN_MIN;
    await store.save(entry);

    const after = manager(store, { b_state: '1', drivers: [] });
    await after.mgr.restore();
    await after.tick();
    assert.strictEqual(after.canceled.length, 1, 'ищет няню 11 минут — снимается');
    assert.deepStrictEqual(await store.load(), [], 'и уходит из store');
    console.log('✅ Test 3: время ожидания считается от первой постановки');
  }

  // --- 4. Завершённый и снятый вручную заказ из store удаляется ---
  {
    const store = redisWatchStore(fakeRedis(), 'children');
    const done = { b_state: '4', drivers: [] };
    const m = manager(store, done);
    m.mgr.registerOrder('4', { orderId: '4', botId: 'b', chatId: 'c' });
    m.mgr.registerOrder('5', { orderId: '5', botId: 'b', chatId: 'c' });
    await new Promise((r) => setImmediate(r));
    assert.strictEqual((await store.load()).length, 2);
    m.mgr.unregisterOrder('5');
    await m.tick();
    await new Promise((r) => setImmediate(r));
    assert.deepStrictEqual(await store.load(), []);
    console.log('✅ Test 4: завершённые и снятые заказы не копятся');
  }

  // --- 5. Без store всё как раньше ---
  {
    const m = manager(undefined, approved);
    m.mgr.registerOrder('6', { orderId: '6', botId: 'b', chatId: 'c' });
    await m.mgr.restore();
    await m.tick();
    assert.deepStrictEqual(m.events, [ORDER_STATUS_EVENTS.APPROVED]);
    console.log('✅ Test 5: без store — только память');
  }

  console.log('\nВсе тесты пройдены');
}

main().catch((e) => { console.error(e); process.exit(1); });
