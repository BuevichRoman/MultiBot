/**
 * Отправка ошибок в мониторинг (задача от 28.08.2026).
 *
 * Настоящего DSN у нас нет, поэтому вместо Sentry поднимается локальный
 * приёмник и события проверяются на нём: доходит ли ошибка, с какими
 * тегами, и молчит ли модуль там, где должен.
 *
 * Запуск: npm run build && node tests/test_monitoring.js
 */

const assert = require('node:assert/strict');
const http = require('node:http');

/** Приёмник конвертов Sentry: отдаёт то, что реально ушло по сети */
function startReceiver() {
  const envelopes = [];
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => {
      envelopes.push(body);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end('{}');
    });
  });

  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      resolve({
        envelopes,
        dsn: `http://publickey@127.0.0.1:${port}/1`,
        close: () => new Promise((done) => server.close(done)),
      });
    });
  });
}

/** Событие из конверта: конверт — это построчный JSON */
function eventsOf(envelopes) {
  return envelopes
    .flatMap((raw) => raw.split('\n'))
    .map((line) => { try { return JSON.parse(line); } catch { return null; } })
    .filter((item) => item && item.exception);
}

async function run() {
  const receiver = await startReceiver();
  process.env.SENTRY_DSN = receiver.dsn;
  process.env.SENTRY_ENV = 'stand';

  const {
    initMonitoring,
    captureError,
    flushMonitoring,
    isMonitoringEnabled,
  } = require('../dist/src/addons/monitoring/index.js');

  initMonitoring();
  assert.equal(isMonitoringEnabled(), true, 'с DSN мониторинг должен включиться');

  // 1. Ошибка опроса заказа доходит вместе с тем, что помогает её найти
  captureError(new Error('getOrderState failed'), {
    tenantId: 'children',
    orderId: '4137',
    scope: 'order-poll',
    chatId: '9638908545',
  });
  await flushMonitoring();

  const events = eventsOf(receiver.envelopes);
  assert.equal(events.length, 1, `должно уйти одно событие, ушло ${events.length}`);

  const event = events[0];
  assert.equal(event.exception.values[0].value, 'getOrderState failed');
  assert.equal(event.tags.tenant, 'children');
  assert.equal(event.tags.orderId, '4137');
  assert.equal(event.tags.scope, 'order-poll');
  assert.equal(event.extra.chatId, '9638908545');
  assert.equal(event.environment, 'stand', 'окружение берётся из SENTRY_ENV');

  // 2. Сетевой шум не отправляем: связь с API рвётся регулярно,
  //    опрос повторится на следующем тике
  const timeout = Object.assign(new Error('timeout of 5000ms exceeded'), { code: 'ECONNABORTED' });
  captureError(timeout, { tenantId: 'children', scope: 'order-poll' });
  await flushMonitoring();

  assert.equal(eventsOf(receiver.envelopes).length, 1, 'сетевой таймаут отправляться не должен');

  // 3. Проводка: падение опроса заказа доходит до мониторинга само,
  //    без ручного captureError на стороне теста
  {
    const { OrderManager } = require('../dist/src/newManagers/OrderManager/OrderManager.js');
    const before = eventsOf(receiver.envelopes).length;

    const manager = new OrderManager('children', {
      getOrderState: async () => { throw new Error('drive/get 500'); },
      cancelOrder: async () => {},
      onSystemEvent: async () => {},
    });
    manager.registerOrder('4137', { botId: 'bot', chatId: 'chat-1', userId: 'u1' });
    await manager.tick();
    await flushMonitoring();

    const events = eventsOf(receiver.envelopes);
    assert.equal(events.length, before + 1, 'падение опроса должно уйти в мониторинг');

    const event = events[events.length - 1];
    assert.equal(event.exception.values[0].value, 'drive/get 500');
    assert.equal(event.tags.scope, 'order-poll');
    assert.equal(event.tags.orderId, '4137');
    assert.equal(event.extra.chatId, 'chat-1');
  }

  // 4. Без DSN модуль молчит: на стенде и в тестах событий быть не должно.
  //    Состояние модуля живёт в процессе, поэтому проверяем отдельным
  const { execFileSync } = require('node:child_process');
  const before = receiver.envelopes.length;
  const output = execFileSync(process.execPath, ['-e', `
    const m = require('${process.cwd()}/dist/src/addons/monitoring/index.js');
    m.initMonitoring();
    m.captureError(new Error('без dsn'), { orderId: '1' });
    console.log(m.isMonitoringEnabled());
  `], { env: { ...process.env, SENTRY_DSN: '' }, encoding: 'utf8' });

  assert.match(output, /false/, 'без DSN мониторинг остаётся выключенным');
  assert.equal(receiver.envelopes.length, before, 'без DSN ничего не отправляется');

  await receiver.close();
  console.log('Все проверки пройдены.');
}

run().catch((e) => {
  console.error('ПРОВАЛ:', e.message);
  process.exit(1);
});
