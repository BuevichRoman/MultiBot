/**
 * Ночной поиск нянь считается по времени заказа, а не по моменту оформления.
 *
 * Запуск: ./node_modules/.bin/ts-node -T tests/test_night_time.ts
 */
import assert from 'assert';
import { isNightTime } from '../src/newManagers/api/utils/sql_templates';
import { DriverSearchManager } from '../src/newManagers/DriverSearchManager';

// Малага, Europe/Madrid (летом UTC+2)
const LAT = 36.728617;
const LNG = -4.434942;

async function main() {
  // --- 1. Время заказа ночью по Мадриду ---
  assert.strictEqual(await isNightTime(LAT, LNG, new Date('2026-09-30T20:10:00Z')), true, '22:10 Madrid — ночь');
  assert.strictEqual(await isNightTime(LAT, LNG, new Date('2026-10-01T03:59:00Z')), true, '05:59 Madrid — ночь');
  console.log('✅ Test 1: ночное время заказа');

  // --- 2. Заказ на утро: днём, даже если оформляют ночью ---
  assert.strictEqual(await isNightTime(LAT, LNG, new Date('2026-10-01T08:00:00Z')), false, '10:00 Madrid — день');
  assert.strictEqual(await isNightTime(LAT, LNG, new Date('2026-10-01T04:00:00Z')), false, '06:00 Madrid — день');
  console.log('✅ Test 2: дневное время заказа');

  // --- 3. Без времени или с битым временем — как раньше, по текущему ---
  const now = await isNightTime(LAT, LNG);
  assert.strictEqual(await isNightTime(LAT, LNG, null), now, 'null — по текущему времени');
  assert.strictEqual(await isNightTime(LAT, LNG, new Date('not a date')), now, 'битая дата — по текущему времени');
  console.log('✅ Test 3: без времени заказа — по текущему');

  // --- 4. DriverSearchManager передаёт время заказа в getDrivers ---
  const calls: Array<Date | null | undefined> = [];
  const manager = new DriverSearchManager(
    'children',
    {
      getDrivers: async (_lat: number, _lng: number, _userId?: string, when?: Date | null) => {
        calls.push(when);
        return [];
      },
    },
    {
      getState: async () => 'main.driverSearch',
      getData: async () => ({ waitingForDrivers: true, when: '2026-10-01T08:00:00.000Z', latitude: LAT, longitude: LNG }),
    },
    { sendMessage: async () => ({}), onSystemEvent: async () => {} },
  );
  manager.start({ chatId: 'chat-night', botId: 'bot1', userId: 'user-1' });
  await new Promise((r) => setTimeout(r, 50));
  manager.stop('chat-night');
  assert.strictEqual(calls.length, 1, 'getDrivers вызван один раз');
  assert.ok(calls[0] instanceof Date, 'в getDrivers передана дата заказа');
  assert.strictEqual((calls[0] as Date).toISOString(), '2026-10-01T08:00:00.000Z');
  console.log('✅ Test 4: время заказа доходит до getDrivers');

  console.log('\n🎉 Все тесты ночного поиска пройдены!');
}

main().catch((e) => {
  console.error('❌', e.message);
  process.exit(1);
});
