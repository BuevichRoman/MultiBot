/**
 * Итоговое сообщение заказчику после завершения заказа (ТЗ-001 п. 10).
 *
 * Проверяет, что после завершения уходит сводка со всеми зарегистрированными
 * перерывами, что короткие перерывы в список не попадают, но в суммы входят,
 * и что без перерывов лишнего сообщения нет.
 *
 * Запуск: npm run build && node tests/test_breaks_final.js
 */

const assert = require('node:assert/strict');
const { handleSendBreaksFinal } = require('../dist/src/engine/handlers/children/actions/OrderActions.js');

/** Контекст действия: нужны четыре метода из всего интерфейса */
function makeCtx(execution) {
  const sent = [];
  return {
    sent,
    ctx: {
      getData: async () => ({ order: { id: '1' }, user: { lang: '1' } }),
      apiManager: {
        getOrderState: async () => (execution === null ? null : { b_execution: execution }),
      },
      // Ключей перерывов в lang_vls нет — движок возвращает сам ключ,
      // и действие должно подставить запасной текст
      getLocalizedText: async (key) => key,
      sendMessage: async (text) => { sent.push(text); },
    },
  };
}

function execution(breaks, totals) {
  return { mode: null, actual: { breaks, ...totals } };
}

async function run() {
  // 1. Два перерыва, оба видимые
  {
    const { ctx, sent } = makeCtx(execution(
      [
        { id: '1', started: '2026-07-28 12:00:00+00:00', ended: '2026-07-28 12:30:00+00:00', display: true },
        { id: '2', started: '2026-07-28 14:00:00+00:00', ended: '2026-07-28 14:15:00+00:00', display: true },
      ],
      { total_seconds: 7200, work_seconds: 4500, break_seconds: 2700, billable_work_seconds: 4500 },
    ));

    await handleSendBreaksFinal(ctx);
    assert.equal(sent.length, 1, 'должно уйти одно сообщение');

    const text = sent[0];
    assert.match(text, /Перерывы: 45 мин \(2\)/, 'сумма и количество перерывов');
    assert.match(text, /Рабочее время: 1 ч 15 мин/, 'рабочее время');
    assert.match(text, /Общее время заказа: 2 ч 0 мин/, 'общее время');
    assert.equal(text.split('\n').length, 3, 'заголовок и две строки списка');
    assert.match(text, /30 мин/, 'длительность первого перерыва');
    assert.match(text, /15 мин/, 'длительность второго перерыва');
  }

  // 2. Короткий перерыв скрыт из списка, но учтён в сумме (ТЗ п. 20)
  {
    const { ctx, sent } = makeCtx(execution(
      [
        { id: '1', started: '2026-07-28 12:00:00+00:00', ended: '2026-07-28 12:30:00+00:00', display: true },
        { id: '2', started: '2026-07-28 13:00:00+00:00', ended: '2026-07-28 13:00:05+00:00', display: false },
      ],
      { total_seconds: 7205, work_seconds: 5400, break_seconds: 1805, billable_work_seconds: 5400 },
    ));

    await handleSendBreaksFinal(ctx);
    const text = sent[0];
    assert.match(text, /\(1\)/, 'в счётчик попадает только видимый перерыв');
    assert.equal(text.split('\n').length, 2, 'в списке одна строка');
    assert.match(text, /Перерывы: 30 мин/, 'сумма включает скрытый перерыв');
  }

  // 3. Перерывов не было — сообщения нет
  {
    const { ctx, sent } = makeCtx(execution(
      [],
      { total_seconds: 3600, work_seconds: 3600, break_seconds: 0, billable_work_seconds: 3600 },
    ));

    await handleSendBreaksFinal(ctx);
    assert.equal(sent.length, 0, 'без перерывов итог не отправляется');
  }

  // 4. Активный перерыв в список не попадает
  {
    const { ctx, sent } = makeCtx(execution(
      [{ id: '1', started: '2026-07-28 12:00:00+00:00', ended: null, display: true }],
      { total_seconds: 3600, work_seconds: 3000, break_seconds: 600, billable_work_seconds: 3000 },
    ));

    await handleSendBreaksFinal(ctx);
    assert.equal(sent.length, 0, 'незакрытый перерыв не считается зарегистрированным');
  }

  // 5. Заказ не прочитался — молчим, а не падаем
  {
    const { ctx, sent } = makeCtx(null);
    await handleSendBreaksFinal(ctx);
    assert.equal(sent.length, 0, 'без состояния заказа сообщений нет');
  }

  console.log('Все проверки пройдены.');
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
