/**
 * Сообщения о перерыве берут время из события, а не из состояния заказа
 * (замечание Валентина от 28.08.2026).
 *
 * Пока действие читает состояние, няня может успеть начать следующий
 * перерыв: последний интервал в ответе API будет уже не тот, о котором
 * пришло событие, и заказчик увидит пустое или чужое время.
 *
 * Запуск: npm run build && node tests/test_break_messages.js
 */

const assert = require('node:assert/strict');
const {
  handleSendBreakStarted,
  handleSendBreakEnded,
} = require('../dist/src/engine/handlers/children/actions/OrderActions.js');

/** breakEvent — то, что MainHandler положил из payload системного события */
function makeCtx(breakEvent, execution) {
  const sent = [];
  return {
    sent,
    ctx: {
      getData: async () => ({ order: { id: '1', breakEvent }, user: { lang: '1' } }),
      apiManager: {
        getOrderState: async () => (execution === null ? null : { b_execution: execution }),
      },
      getLocalizedText: async (key) => key,
      sendMessage: async (text) => { sent.push(text); },
    },
  };
}

const br = (id, started, ended, display = true) => ({ id, started, ended, display });

async function run() {
  // 1. Пока шло чтение, начался следующий перерыв: последний интервал
  //    состояния активен, время окончания в нём null
  {
    const { ctx, sent } = makeCtx(
      { endedAt: '2026-08-28 10:20:00+00:00', breakSeconds: 1200 },
      {
        mode: 'break',
        actual: {
          breaks: [
            br('1', '2026-08-28 10:00:00+00:00', '2026-08-28 10:20:00+00:00'),
            br('2', '2026-08-28 10:21:00+00:00', null),
          ],
          total_seconds: 5400,
          work_seconds: 4200,
          break_seconds: 1200,
          billable_work_seconds: 4200,
        },
      },
    );

    await handleSendBreakEnded(ctx);
    assert.match(sent[0], /завершила перерыв в 10:20|завершила перерыв в \d\d:20/, `время окончания из события, получено: ${sent[0]}`);
    assert.doesNotMatch(sent[0], /в \.$/, 'время не должно теряться');
    assert.match(sent[1], /Перерывов: 1/, 'в сводке считаются только завершённые видимые');
  }

  // 2. Начало перерыва тоже из события
  {
    const { ctx, sent } = makeCtx(
      { startedAt: '2026-08-28 11:05:00+00:00' },
      { mode: 'work', actual: { breaks: [], total_seconds: 0, work_seconds: 0, break_seconds: 0, billable_work_seconds: 0 } },
    );

    await handleSendBreakStarted(ctx);
    assert.match(sent[0], /начала перерыв в \d\d:05/, `время начала из события, получено: ${sent[0]}`);
  }

  // 3. Без события работает прежний путь — чтение состояния
  {
    const { ctx, sent } = makeCtx(undefined, {
      mode: 'break',
      actual: {
        breaks: [br('1', '2026-08-28 12:30:00+00:00', null)],
        total_seconds: 600, work_seconds: 600, break_seconds: 0, billable_work_seconds: 600,
      },
    });

    await handleSendBreakStarted(ctx);
    assert.match(sent[0], /начала перерыв в \d\d:30/, `запасной путь, получено: ${sent[0]}`);
  }

  // 4. Состояние недоступно: время из события всё равно показываем,
  //    сводку с суммами — нет
  {
    const { ctx, sent } = makeCtx({ endedAt: '2026-08-28 13:45:00+00:00' }, null);

    await handleSendBreakEnded(ctx);
    assert.equal(sent.length, 1, 'без состояния уходит только сообщение об окончании');
    assert.match(sent[0], /завершила перерыв в \d\d:45/);
  }

  console.log('Все проверки пройдены.');
}

run().catch((e) => {
  console.error('ПРОВАЛ:', e.message);
  process.exit(1);
});
