/**
 * Шаг плановых перерывов временно скрыт (01.10.2026): после ввода времени
 * бот сразу показывает подтверждение заказа. Само состояние в схеме
 * осталось, чтобы шаг можно было вернуть одной правкой перехода.
 *
 * Запуск: node tests/test_planned_breaks_hidden.js
 */

const assert = require('node:assert/strict');
const schema = require('../src/engine/schemas/children/main.json');

const whenOk = schema.states.when.transitions.find((t) => t.event === 'ok');
assert.equal(whenOk.to, 'main.confirm', 'после времени — сразу подтверждение');
assert.deepEqual(whenOk.actions, ['sendCollectionOrderConfirm']);
console.log('✅ when → confirm, вопрос о перерывах не задаётся');

const reachable = Object.values(schema.states)
    .flatMap((s) => s.transitions || [])
    .filter((t) => t.to === 'main.plannedBreaks' && t.event !== 'error');
assert.equal(reachable.length, 0, 'в шаг перерывов никто не ведёт');
console.log('✅ в шаг перерывов не ведёт ни один переход');

assert.ok(schema.states.plannedBreaks, 'состояние сохранено, чтобы вернуть шаг');
assert.ok(schema.actions.sendPlannedBreaksPrompt, 'действие вопроса сохранено');
console.log('✅ состояние и действие шага сохранены');
