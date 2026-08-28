/**
 * Живой сквозной прогон стороны заказчика (ТЗ-001).
 *
 * В отличие от test_live_orders.js (данные из БД, ответ сервера собран руками),
 * здесь live_bookings.json — РЕАЛЬНЫЙ ответ боевого API /drive/get/{id}
 * ?fields=000000002, полученный входом под заказчиком 888 22.08.2026.
 * Гоняем боевой код бота ровно на том, что вернул сервер по сети:
 *   booking -> mapOrderState -> b_execution -> handleSendBreaksFinal -> текст.
 *
 * Запуск: npm run build && node tests/test_live_wire.js
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { mapOrderState } = require('../dist/src/newManagers/api/APIManager.js');
const OrderActions = require('../dist/src/engine/handlers/children/actions/OrderActions.js');

const BOOKINGS = JSON.parse(
  fs.readFileSync(path.join(__dirname, 'live_bookings.json'), 'utf8'),
);

function makeCtx(orderId, mapped) {
  const sent = [];
  return {
    sent,
    getData: async () => ({ order: { id: orderId }, user: { lang: '1' } }),
    apiManager: { getOrderState: async () => mapped },
    getLocalizedText: async (key) => key, // запасной текст из кода
    sendMessage: async (text) => { sent.push(text); },
  };
}

async function run() {
  for (const [orderId, booking] of Object.entries(BOOKINGS)) {
    console.log(`\n===== заказ ${orderId} (живой ответ сервера) =====`);

    // booking пришёл ровно из ответа /drive/get — как его получает бот
    const mapped = mapOrderState(booking);
    assert.equal(mapped.b_state, 4, 'состояние приведено к числу');

    // план приехал в b_options.b_execution.estimate, факт — в c_options
    const est = booking.b_options?.b_execution?.estimate;
    assert.ok(est && est.breaks.length === 2, 'план из b_options разобран сервером');

    const actual = mapped.b_execution?.actual;
    assert.ok(actual, 'факт прочитан из c_options.c_execution живого ответа');
    assert.equal(actual.breaks.length, 1, 'фактический перерыв на месте');
    assert.ok(actual.break_seconds > 0, 'перерыв учтён в суммах');
    console.log('  mapOrderState: b_state=%d, mode=%s, план-перерывов=%d, факт-перерывов=%d, break_seconds=%d',
      mapped.b_state, String(mapped.b_execution.mode),
      est.breaks.length, actual.breaks.length, actual.break_seconds);

    const ctx = makeCtx(orderId, mapped);
    await OrderActions.handleSendBreaksFinal(ctx);
    assert.equal(ctx.sent.length, 1, 'заказчику ушло одно сообщение');
    console.log('  сообщение заказчику из ЖИВЫХ данных:');
    console.log('    | ' + ctx.sent[0]);
  }
  console.log('\nЖивой сквозной прогон стороны заказчика пройден.');
}

run().catch((e) => { console.error(e); process.exit(1); });
