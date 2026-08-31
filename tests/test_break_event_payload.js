/**
 * Системное событие перерыва сохраняет свои метки времени в данных заказа,
 * откуда их берут действия sendBreakStarted / sendBreakEnded.
 *
 * Запуск: npm run build && node tests/test_break_event_payload.js
 */

const assert = require('node:assert/strict');
const { MainHandler } = require('../dist/src/engine/handlers/children/MainHandler.js');

/** Подставные orchestrator и fsm: интересен только вызов mergeData */
function makeHandler() {
  const merged = [];
  const fsm = {
    loadSchema: async () => ({ states: {} }),
    mergeData: async (tenantId, userId, patch) => { merged.push(patch); },
    transition: async () => ({ actions: [], to: undefined }),
    getEntryActions: () => [],
  };
  const handler = new MainHandler({ engine: {} }, fsm, {});
  return { handler, merged };
}

async function run() {
  const started = makeHandler();
  await started.handler.handle({
    botId: 'bot',
    chatId: 'chat',
    userId: 'u1',
    text: '',
    isSystemEvent: true,
    event: 'order_status_break_started',
    payload: { orderId: '1', breakStartedAt: '2026-08-28 10:00:00+00:00' },
  }, 'order.driverStarted');

  assert.deepEqual(
    started.merged[0]?.order?.breakEvent?.startedAt,
    '2026-08-28 10:00:00+00:00',
    'начало перерыва должно попасть в данные заказа',
  );

  const ended = makeHandler();
  await ended.handler.handle({
    botId: 'bot',
    chatId: 'chat',
    userId: 'u1',
    text: '',
    isSystemEvent: true,
    event: 'order_status_break_ended',
    payload: { orderId: '1', breakEndedAt: '2026-08-28 10:20:00+00:00', breakSeconds: 1200 },
  }, 'order.onBreak');

  const event = ended.merged[0]?.order?.breakEvent;
  assert.equal(event?.endedAt, '2026-08-28 10:20:00+00:00');
  assert.equal(event?.breakSeconds, 1200);

  // Обычное сообщение данных события не пишет
  const plain = makeHandler();
  await plain.handler.handle({
    botId: 'bot', chatId: 'chat', userId: 'u1', text: 'привет',
  }, 'order.driverStarted');
  assert.deepEqual(
    plain.merged.filter((p) => p?.order?.breakEvent),
    [],
    'сообщение пользователя не должно трогать breakEvent',
  );

  console.log('Все проверки пройдены.');
}

run().catch((e) => {
  console.error('ПРОВАЛ:', e.message);
  process.exit(1);
});
