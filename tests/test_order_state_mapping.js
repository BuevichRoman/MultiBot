/**
 * Проверка разбора ответа drive/get (ТЗ-001).
 *
 * Стык с формой ответа боевого API раньше был непокрыт, и именно на нём
 * пряталась ошибка: перерывы искали в b_options, а няня писать туда не может
 * и пишет в свой c_options. Тест фиксирует, откуда берётся факт.
 *
 * Запуск: npm run build && node tests/test_order_state_mapping.js
 */

const assert = require('node:assert/strict');
const { mapOrderState } = require('../dist/src/newManagers/api/APIManager.js');

const execution = {
  schema_version: 1,
  mode: 'break',
  actual: {
    started: '2026-08-10 10:00:00+03:00',
    ended: null,
    breaks: [
      {
        id: '1-1',
        started: '2026-08-10 11:00:00+03:00',
        ended: null,
        display: true,
      },
    ],
    total_seconds: 3600,
    work_seconds: 3600,
    break_seconds: 0,
    billable_work_seconds: 3600,
  },
};

function run() {
  // Факт берётся из c_options няни, а не из b_options заказа
  const withBreaks = mapOrderState({
    b_state: '2',
    b_start_datetime: '2026-08-10 10:00:00+03:00',
    b_options: { b_execution: { schema_version: 1, estimate: null } },
    drivers: [{ u_id: 'nanny-1', c_options: { c_execution: execution } }],
  });

  assert.equal(withBreaks.b_state, 2, 'состояние заказа приводится к числу');
  assert.equal(withBreaks.b_execution?.mode, 'break', 'режим читается из c_options');
  assert.equal(
    withBreaks.b_execution?.actual?.breaks?.length,
    1,
    'перерывы читаются из c_options',
  );

  // Плановая смета в b_options фактом не притворяется
  const planOnly = mapOrderState({
    b_state: '2',
    b_options: {
      b_execution: {
        schema_version: 1,
        estimate: { started: 'x', ended: 'y', breaks: [] },
      },
    },
    drivers: [{ u_id: 'nanny-1' }],
  });

  assert.equal(
    planOnly.b_execution,
    undefined,
    'без c_options факта нет, даже если в b_options лежит план',
  );

  // Заказ до включения функционала
  const legacy = mapOrderState({ b_state: '2' });
  assert.equal(legacy.b_execution, undefined, 'старый заказ разбирается без ошибки');
  assert.deepEqual(legacy.drivers, undefined, 'отсутствие исполнителей не ломает разбор');

  // Заказчик видит блоки всех исполнителей — берём тот, где факт есть
  const many = mapOrderState({
    b_state: '2',
    drivers: [
      { u_id: 'other', c_options: { performers_price: 100 } },
      { u_id: 'nanny-1', c_options: { c_execution: execution } },
    ],
  });

  assert.equal(many.b_execution?.mode, 'break', 'факт находится среди нескольких исполнителей');

  console.log('Все проверки пройдены.');
}

run();
