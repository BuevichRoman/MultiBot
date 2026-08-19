/**
 * Прогон боевого кода бота на РЕАЛЬНЫХ заказах из боевой базы (ТЗ-001).
 *
 * Данные — order_driver.options заказов 4137 и 4138 (children), выгружены из
 * боевой базы 19.08.2026. Оба завершены, у обоих перерыв короче минуты
 * (display:false) — случай «в суммы входит, в список нет», которого не было
 * в test_order_state_mapping.js (там mode:'break', активный перерыв).
 *
 * Проверяем всю цепочку заказчика на реальном ответе сервера:
 *   booking (data.booking[id]) -> mapOrderState -> b_execution
 *   -> handleSendBreaksFinal -> текст, который уходит заказчику.
 *
 * Запуск: npm run build && node tests/test_live_orders.js
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { mapOrderState } = require('../dist/src/newManagers/api/APIManager.js');
const OrderActions = require('../dist/src/engine/handlers/children/actions/OrderActions.js');

const ORDERS = JSON.parse(
  fs.readFileSync(path.join(__dirname, 'real_orders.json'), 'utf8'),
);

/** ctx как в бою: getOrderState отдаёт результат mapOrderState по booking */
function makeCtx(orderId, mapped) {
  const sent = [];
  return {
    sent,
    getData: async () => ({ order: { id: orderId }, user: { lang: '1' } }),
    apiManager: { getOrderState: async () => mapped },
    // как на боевом до полной локализации: ключ не найден -> запасной текст в коде
    getLocalizedText: async (key) => key,
    sendMessage: async (text) => { sent.push(text); },
  };
}

async function run() {
  for (const [orderId, booking] of Object.entries(ORDERS)) {
    console.log(`\n===== заказ ${orderId} =====`);

    // 1. Реальный парсер на реальном ответе сервера
    const mapped = mapOrderState(booking);
    assert.equal(mapped.b_state, 4, 'состояние приведено к числу');
    const actual = mapped.b_execution?.actual;
    assert.ok(actual, 'факт прочитан из c_options.c_execution');
    assert.equal(actual.breaks.length, 1, 'перерыв найден');
    assert.equal(actual.breaks[0].display, false, 'короткий перерыв скрыт');
    assert.ok(actual.break_seconds > 0, 'но в суммах он учтён');
    console.log('  mapOrderState: b_state=%d, mode=%s, breaks=%d, break_seconds=%d, billable=%d',
      mapped.b_state, String(mapped.b_execution.mode),
      actual.breaks.length, actual.break_seconds, actual.billable_work_seconds);

    // 2. Реальная сборка сообщения заказчику
    const ctx = makeCtx(orderId, mapped);
    await OrderActions.handleSendBreaksFinal(ctx);
    assert.equal(ctx.sent.length, 1, 'заказчику ушло одно сообщение');
    console.log('  сообщение заказчику:');
    console.log(ctx.sent[0].split('\n').map((l) => '    | ' + l).join('\n'));

    // короткий перерыв: %breaks% ненулевой, но строк-пунктов нет (count 0)
    assert.ok(/0/.test(ctx.sent[0]), 'видимых перерывов ноль');
  }
  console.log('\nВсе проверки на реальных заказах пройдены.');
}

run().catch((e) => { console.error(e); process.exit(1); });
