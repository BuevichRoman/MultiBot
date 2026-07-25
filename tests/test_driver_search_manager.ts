/**
 * Тесты для DriverSearchManager (src/newManagers/DriverSearchManager).
 *
 * Запуск:
 *   npx ts-node tests/test_driver_search_manager.ts           # mock-тесты
 *   npx ts-node tests/test_driver_search_manager.ts --live    # тест с реальным API
 */
import assert from 'assert';
import path from 'path';
import { DriverSearchManager } from '../src/newManagers/DriverSearchManager';
import type { DriverItem, DriverSearchSystemPayload } from '../src/newManagers/DriverSearchManager';
import { DRIVER_SEARCH_EVENTS } from '../src/newManagers/DriverSearchManager';
import { APIManager } from '../src/newManagers/api/APIManager';
import defaultLogger from '../src/addons/logger';

async function delay(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

const LIVE_TEST = process.argv.includes('--live');

const REAL_API_CONFIG = {
  url: 'https://ibronevik.ru/taxi/c/children/api/v1/',
  adminCredentials: {
    login: 'redacted@example.invalid',
    password: 'REDACTED-ADMIN-PASSWORD',
    type: 'e-mail' as const,
  },
  adminAuthFile: path.join(process.cwd(), 'data', 'default-api.json'),
};

async function runLiveApiTest() {
  console.log('=== DriverSearchManager LIVE API Test ===\n');
  console.log('API:', REAL_API_CONFIG.url);

  const apiManager = new APIManager(
    REAL_API_CONFIG.url,
    REAL_API_CONFIG.adminCredentials as any,
    REAL_API_CONFIG.adminAuthFile,
    defaultLogger,
    '[API:live-test]',
  );

  await apiManager.loginAdmin();
  console.log('✅ API auth OK\n');

  if (!apiManager.api_data_manager.isLoaded) {
    await apiManager.api_data_manager.load();
  }

  let lastPayload: DriverSearchSystemPayload | null = null;
  const mockFsm = {
    getState: async () => 'main.driverSearch',
    getData: async () => ({
      waitingForDrivers: true,
      when: null,
      latitude: 36.42,
      longitude: -4.25,
    }),
  };

  const manager = new DriverSearchManager(
    'children',
    apiManager,
    mockFsm,
    {
      sendMessage: async (_chatId: string, text: string) => {
        console.log('[sendMessage]', text);
        return {};
      },
      onSystemEvent: async (p: DriverSearchSystemPayload) => {
        lastPayload = p;
        console.log('[onSystemEvent]', p.event, p.payload);
      },
      searchPeriodShort: 5,
      debug: true,
    },
  );

  manager.start({
    chatId: 'live-chat',
    botId: 'live-bot',
    userId: 'live-user',
    maxAttempts: 1,
  });

  await delay(3000);

  assert(lastPayload !== null, 'onSystemEvent must be called');
  const payload = lastPayload as DriverSearchSystemPayload;
  assert(
    payload.event === DRIVER_SEARCH_EVENTS.DRIVERS_FOUND ||
      payload.event === DRIVER_SEARCH_EVENTS.NO_DRIVERS,
    `expected drivers_found or no_drivers, got ${payload.event}`,
  );

  console.log('\n✅ LIVE API test passed:', payload.event);
  if (payload.event === DRIVER_SEARCH_EVENTS.DRIVERS_FOUND) {
    console.log('   driversMap:', payload.payload?.driversMap);
  } else {
    console.log('   reason:', payload.payload?.reason);
  }
}

async function runTests() {
  console.log('=== DriverSearchManager Tests ===\n');

  if (LIVE_TEST) {
    await runLiveApiTest();
    return;
  }

  const mockApiManager = (drivers: DriverItem[] = []) => ({
    getDrivers: async () => drivers,
  });

  const mockFsm = (overrides: Record<string, unknown> = {}) => ({
    getState: async () => 'main.driverSearch',
    getData: async () => overrides,
  });

  // --- 1. start / stop / isActive ---
  {
    const sent: string[] = [];
    const manager = new DriverSearchManager(
      'children',
      mockApiManager([]),
      mockFsm({}),
      {
        sendMessage: async (_chatId, text) => {
          sent.push(text);
          return {};
        },
        onSystemEvent: async () => {},
        debug: true,
      },
    );

    assert(!manager.isActive('chat-1'), 'should not be active initially');

    manager.start({ chatId: 'chat-1', botId: 'bot1', userId: 'user-1' });
    assert(manager.isActive('chat-1'), 'should be active after start');

    await delay(50); // даём poll выполниться

    manager.stop('chat-1');
    assert(!manager.isActive('chat-1'), 'should not be active after stop');

    console.log('✅ Test 1: start / stop / isActive passed\n');
  }

  // --- 2. drivers_found при первой попытке ---
  {
    const sent: string[] = [];
    let lastPayload: DriverSearchSystemPayload | null = null;

    const mockDrivers: DriverItem[] = [
      { id_user: 'dr1', name: 'Иван', family: 'Иванов', distance: '2' },
      { id_user: 'dr2', name: 'Петр', family: 'Петров' },
    ];

    const manager = new DriverSearchManager(
      'children',
      mockApiManager(mockDrivers),
      mockFsm({ waitingForDrivers: true, when: null, latitude: 36.7, longitude: -4.4 }),
      {
        sendMessage: async (_chatId, text) => {
          sent.push(text);
          return {};
        },
        onSystemEvent: async (p) => {
          lastPayload = p;
        },
        searchPeriodShort: 5,
        debug: true,
      },
    );

    manager.start({ chatId: 'chat-2', botId: 'bot1', userId: 'user-2', maxAttempts: 3 });
    await delay(150);

    assert(lastPayload !== null, 'onSystemEvent should be called');
    const p = lastPayload as DriverSearchSystemPayload;
    assert.strictEqual(p.event, DRIVER_SEARCH_EVENTS.DRIVERS_FOUND, 'event should be drivers_found');
    assert.strictEqual(p.payload?.driversMap?.['1'], 'dr1', 'driversMap 1 -> dr1');
    assert.strictEqual(p.payload?.driversMap?.['2'], 'dr2', 'driversMap 2 -> dr2');
    assert(sent.length >= 2, 'should send prompt + list');
    assert(!manager.isActive('chat-2'), 'should stop after drivers_found');

    console.log('✅ Test 2: drivers_found passed\n');
  }

  // --- 3. no_drivers (search_cancelled — нет waiting) ---
  {
    let lastPayload: DriverSearchSystemPayload | null = null;

    const manager = new DriverSearchManager(
      'children',
      mockApiManager([]),
      mockFsm({ waitingForDrivers: false, when: null, latitude: 36.7, longitude: -4.4 }),
      {
        sendMessage: async () => ({}),
        onSystemEvent: async (p) => {
          lastPayload = p;
        },
        debug: true,
      },
    );

    manager.start({ chatId: 'chat-3', botId: 'bot1', maxAttempts: 1 });
    await delay(100);

    assert(lastPayload !== null, 'onSystemEvent should be called');
    const p = lastPayload as DriverSearchSystemPayload;
    assert.strictEqual(p.event, DRIVER_SEARCH_EVENTS.NO_DRIVERS, 'event should be no_drivers');
    assert.strictEqual(p.payload?.reason, 'search_cancelled', 'reason should be search_cancelled');

    console.log('✅ Test 3: no_drivers (search_cancelled) passed\n');
  }

  // --- 4. no_drivers (no_coords) ---
  {
    let lastPayload: DriverSearchSystemPayload | null = null;

    const manager = new DriverSearchManager(
      'children',
      mockApiManager([]),
      mockFsm({ waitingForDrivers: true, when: null }),
      {
        sendMessage: async () => ({}),
        onSystemEvent: async (p) => {
          lastPayload = p;
        },
        debug: true,
      },
    );

    manager.start({ chatId: 'chat-4', botId: 'bot1', maxAttempts: 1 });
    await delay(100);

    assert(lastPayload !== null);
    const p = lastPayload as DriverSearchSystemPayload;
    assert.strictEqual(p.event, DRIVER_SEARCH_EVENTS.NO_DRIVERS);
    assert.strictEqual(p.payload?.reason, 'no_coords');

    console.log('✅ Test 4: no_drivers (no_coords) passed\n');
  }

  // --- 5. no_drivers (no_time) ---
  {
    let lastPayload: DriverSearchSystemPayload | null = null;

    const manager = new DriverSearchManager(
      'children',
      mockApiManager([]),
      mockFsm({ waitingForDrivers: true, latitude: 36.7, longitude: -4.4 }),
      {
        sendMessage: async () => ({}),
        onSystemEvent: async (p) => {
          lastPayload = p;
        },
        debug: true,
      },
    );

    manager.start({ chatId: 'chat-5', botId: 'bot1', maxAttempts: 1 });
    await delay(100);

    assert(lastPayload !== null);
    const p = lastPayload as DriverSearchSystemPayload;
    assert.strictEqual(p.event, DRIVER_SEARCH_EVENTS.NO_DRIVERS);
    assert.strictEqual(p.payload?.reason, 'no_time');

    console.log('✅ Test 5: no_drivers (no_time) passed\n');
  }

  // --- 6. no_drivers (maxAttempts) — пустой ответ getDrivers, 1 попытка ---
  {
    let lastPayload: DriverSearchSystemPayload | null = null;

    const manager = new DriverSearchManager(
      'children',
      mockApiManager([]),
      mockFsm({ waitingForDrivers: true, when: null, latitude: 36.7, longitude: -4.4 }),
      {
        sendMessage: async () => ({}),
        onSystemEvent: async (p) => {
          lastPayload = p;
        },
        searchPeriodShort: 1,
        debug: true,
      },
    );

    manager.start({ chatId: 'chat-6', botId: 'bot1', maxAttempts: 1 });
    await delay(200);

    assert(lastPayload !== null);
    const p = lastPayload as DriverSearchSystemPayload;
    assert.strictEqual(p.event, DRIVER_SEARCH_EVENTS.NO_DRIVERS);
    assert.strictEqual(p.payload?.reason, 'no_drivers');

    console.log('✅ Test 6: no_drivers (maxAttempts) passed\n');
  }

  console.log('🎉 Все тесты DriverSearchManager пройдены!\n');
}

runTests().catch((err) => {
  console.error('TEST FAILED:', err);
  process.exit(1);
});
