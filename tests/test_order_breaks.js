/**
 * Проверка событий перерывов в OrderManager (ТЗ-001 п. 10).
 *
 * Прогоняет цикл работа → перерыв → работа → завершение через подставной
 * API и сверяет, какие события ушли в движок.
 *
 * Запуск: npm run build && node tests/test_order_breaks.js
 */

const assert = require('node:assert/strict');
const { OrderManager } = require('../dist/src/newManagers/OrderManager/OrderManager.js');

/** Заказ в работе, при желании с активным или завершённым перерывом */
function orderData(mode, breaks = []) {
  return {
    b_state: 2,
    drivers: [{ u_id: 'nanny-1', c_appointed: '1', c_arrived: '1', c_started: '1' }],
    b_execution: {
      mode,
      actual: {
        breaks,
        total_seconds: 3600,
        work_seconds: 2700,
        break_seconds: 900,
        billable_work_seconds: 2700,
      },
    },
  };
}

async function run() {
  let current = orderData('work');
  const emitted = [];

  const manager = new OrderManager('children', {
    getOrderState: async () => current,
    cancelOrder: async () => {},
    onSystemEvent: async (payload) => {
      emitted.push({ event: payload.event, payload: payload.payload });
    },
  });

  manager.registerOrder('1', { botId: 'bot', chatId: 'chat', userId: 'u1' });
  const tick = () => manager.tick();

  // 1. Первый опрос: няня работает — обычный статус, о перерыве молчим
  await tick();
  assert.deepEqual(
    emitted.map((e) => e.event),
    ['order_status_driver_started'],
    'первый опрос не должен порождать событий перерыва',
  );

  // 2. Повторный опрос без изменений — ничего нового
  await tick();
  assert.equal(emitted.length, 1, 'без изменений событий быть не должно');

  // 3. Няня ушла на перерыв
  current = orderData('break', [{ id: '1', started: '2026-07-28T12:35:00.000Z', ended: null, display: true }]);
  await tick();
  assert.equal(emitted.at(-1).event, 'order_status_break_started');
  assert.equal(emitted.at(-1).payload.breakStartedAt, '2026-07-28T12:35:00.000Z');

  // 4. Пока перерыв идёт, событие не повторяется
  await tick();
  assert.equal(emitted.length, 2, 'событие начала перерыва не должно дублироваться');

  // 5. Няня вернулась к работе
  current = orderData('work', [
    { id: '1', started: '2026-07-28T12:35:00.000Z', ended: '2026-07-28T13:10:00.000Z', display: true },
  ]);
  await tick();
  assert.equal(emitted.at(-1).event, 'order_status_break_ended');
  assert.equal(emitted.at(-1).payload.breakEndedAt, '2026-07-28T13:10:00.000Z');

  // 6. Статус заказа при этом не переоткрывался
  const started = emitted.filter((e) => e.event === 'order_status_driver_started');
  assert.equal(started.length, 1, 'возврат к работе не должен повторять driver_started');

  // 7. Второй перерыв за тот же заказ
  current = orderData('break', [
    { id: '1', started: '2026-07-28T12:35:00.000Z', ended: '2026-07-28T13:10:00.000Z', display: true },
    { id: '2', started: '2026-07-28T15:00:00.000Z', ended: null, display: true },
  ]);
  await tick();
  assert.equal(emitted.at(-1).event, 'order_status_break_started');
  assert.equal(emitted.at(-1).payload.breakStartedAt, '2026-07-28T15:00:00.000Z');

  // 8. Завершение заказа во время перерыва (ТЗ п. 17)
  current = {
    b_state: 2,
    drivers: [{ u_id: 'nanny-1', c_appointed: '1', c_arrived: '1', c_started: '1', c_completed: '1' }],
    b_execution: { mode: null, actual: { breaks: [], total_seconds: 0, work_seconds: 0, break_seconds: 0, billable_work_seconds: 0 } },
  };
  await tick();
  assert.equal(
    emitted.at(-1).event,
    'order_status_completed',
    'завершение заказа должно быть последним событием',
  );
  // Сервер закрывает активный перерыв сам (ТЗ п. 17), отдельного
  // уведомления об этом заказчик получать не должен
  assert.equal(
    emitted.filter((e) => e.event === 'order_status_break_ended').length,
    1,
    'окончание перерыва должно быть ровно одно — то, что няня сделала сама',
  );

  console.log('Порядок событий:');
  emitted.forEach((e, i) => console.log(`  ${i + 1}. ${e.event}`));
  console.log('\nВсе проверки пройдены.');
}

run().catch((e) => {
  console.error('ПРОВАЛ:', e.message);
  process.exit(1);
});
