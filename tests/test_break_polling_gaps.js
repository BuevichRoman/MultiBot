/**
 * Перерывы, попавшие между двумя опросами (замечание Валентина от 28.08.2026).
 *
 * Обнаружение по одному только b_execution.mode пропускает всё, что успело
 * начаться и закончиться внутри интервала опроса. Здесь проверяется
 * обнаружение по составу actual.breaks[]: новый интервал — начало,
 * появившийся ended — окончание.
 *
 * Запуск: npm run build && node tests/test_break_polling_gaps.js
 */

const assert = require('node:assert/strict');
const { OrderManager } = require('../dist/src/newManagers/OrderManager/OrderManager.js');

function orderData(mode, breaks = [], completed = false) {
  return {
    b_state: 2,
    drivers: [{
      u_id: 'nanny-1',
      c_appointed: '1',
      c_arrived: '1',
      c_started: '1',
      ...(completed ? { c_completed: '1' } : {}),
    }],
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

const br = (id, started, ended, display = true) => ({ id, started, ended, display });

/** Свежий менеджер с одним заказом; возвращает поллер и журнал событий */
function makeWatch() {
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

  return {
    emitted,
    /** Один опрос с указанным состоянием заказа */
    poll: async (data) => {
      if (data) current = data;
      await manager.tick();
    },
    breakEvents: () => emitted.filter((e) => e.event.startsWith('order_status_break')),
  };
}

async function run() {
  // 1. Перерыв сменился другим внутри одного интервала: mode на обоих
  //    опросах 'break', но интервалы разные
  {
    const w = makeWatch();
    await w.poll(orderData('work'));
    await w.poll(orderData('break', [br('1', '2026-08-28 10:00:00+00:00', null)]));
    await w.poll(orderData('break', [
      br('1', '2026-08-28 10:00:00+00:00', '2026-08-28 10:20:00+00:00'),
      br('2', '2026-08-28 10:21:00+00:00', null),
    ]));

    const events = w.breakEvents();
    assert.deepEqual(
      events.map((e) => e.event),
      ['order_status_break_started', 'order_status_break_ended', 'order_status_break_started'],
      'смена перерывов между опросами должна дать окончание первого и начало второго',
    );
    assert.equal(events[1].payload.breakEndedAt, '2026-08-28 10:20:00+00:00');
    assert.equal(events[2].payload.breakStartedAt, '2026-08-28 10:21:00+00:00');
  }

  // 2. Перерыв целиком между опросами: mode вернулся в 'work' к следующему
  //    разу, но интервал видимый — заказчик должен получить обе метки
  {
    const w = makeWatch();
    await w.poll(orderData('work'));
    await w.poll(orderData('work', [br('1', '2026-08-28 11:00:00+00:00', '2026-08-28 11:05:00+00:00')]));

    const events = w.breakEvents();
    assert.deepEqual(
      events.map((e) => e.event),
      ['order_status_break_started', 'order_status_break_ended'],
      'пропущенный целиком перерыв не должен теряться',
    );
    assert.equal(events[0].payload.breakStartedAt, '2026-08-28 11:00:00+00:00');
    assert.equal(events[1].payload.breakEndedAt, '2026-08-28 11:05:00+00:00');
  }

  // 3. Такой же пропущенный перерыв, но короче min_visible_break_duration:
  //    приложение няни пометило его display:false, в уведомлениях его нет
  //    (ТЗ п. 20), в суммах он остаётся
  {
    const w = makeWatch();
    await w.poll(orderData('work'));
    await w.poll(orderData('work', [
      br('1', '2026-08-28 11:00:00+00:00', '2026-08-28 11:00:03+00:00', false),
    ]));

    assert.deepEqual(w.breakEvents(), [], 'скрытый перерыв не должен порождать уведомлений');
  }

  // 4. Заказ подхвачен на середине перерыва: первый опрос только запоминает
  {
    const w = makeWatch();
    await w.poll(orderData('break', [br('1', '2026-08-28 09:00:00+00:00', null)]));
    await w.poll(orderData('break', [br('1', '2026-08-28 09:00:00+00:00', null)]));

    assert.deepEqual(w.breakEvents(), [], 'о перерыве, начатом до наблюдения, не сообщаем');
  }

  // 5. Заказ завершён во время перерыва: интервал закрывает приложение няни,
  //    отдельного «перерыв окончен» после сообщения о завершении быть не должно
  {
    const w = makeWatch();
    await w.poll(orderData('work'));
    await w.poll(orderData('break', [br('1', '2026-08-28 12:00:00+00:00', null)]));
    await w.poll(orderData(
      null,
      [br('1', '2026-08-28 12:00:00+00:00', '2026-08-28 12:30:00+00:00')],
      true,
    ));

    const events = w.breakEvents();
    assert.deepEqual(
      events.map((e) => e.event),
      ['order_status_break_started'],
      'после завершения заказа отдельного окончания перерыва не шлём',
    );
    assert.equal(w.emitted.at(-1).event, 'order_status_completed');
  }

  // 6. Повторные опросы без изменений событий не порождают
  {
    const w = makeWatch();
    await w.poll(orderData('work'));
    await w.poll(orderData('break', [br('1', '2026-08-28 13:00:00+00:00', null)]));
    await w.poll();
    await w.poll(orderData('work', [br('1', '2026-08-28 13:00:00+00:00', '2026-08-28 13:40:00+00:00')]));
    await w.poll();
    await w.poll();

    assert.deepEqual(
      w.breakEvents().map((e) => e.event),
      ['order_status_break_started', 'order_status_break_ended'],
      'события перерыва не должны дублироваться',
    );
  }

  console.log('Все проверки пройдены.');
}

run().catch((e) => {
  console.error('ПРОВАЛ:', e.message);
  process.exit(1);
});
