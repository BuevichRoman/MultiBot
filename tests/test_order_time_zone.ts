/**
 * Время заказа считается в поясе места заказа, а не по фиксированному UTC+1.
 * Повод — заказ 4154: в Малаге ввели «Завтра 11:00» (CEST, UTC+2), а в API ушло 10:00Z.
 *
 * Запуск: ./node_modules/.bin/ts-node -T tests/test_order_time_zone.ts
 */
import assert from 'assert';
import { Settings } from 'luxon';
import { parseWhen } from '../src/engine/children/parsers';
import { orderTimeZone, FALLBACK_TIME_ZONE } from '../src/engine/children/order/orderTimeZone';

const MALAGA = orderTimeZone('36.728113', '-4.434947');
const MOSCOW = orderTimeZone(55.7558, 37.6173);

function at(nowIso: string, text: string, zone: string): string | undefined {
    Settings.now = () => new Date(nowIso).getTime();
    return parseWhen(text, zone)?.toISOString();
}

assert.strictEqual(MALAGA, 'Europe/Madrid');
assert.strictEqual(MOSCOW, 'Europe/Moscow');
assert.strictEqual(orderTimeZone(undefined, undefined), FALLBACK_TIME_ZONE, 'без координат — прежний UTC+1');

// Заказ 4154: оформлен 04.10 в 23:50 по Малаге
assert.strictEqual(at('2026-10-04T21:50:00Z', 'Завтра 11:00', MALAGA), '2026-10-05T09:00:00.000Z', 'летом Малага UTC+2');
// Зимой там UTC+1
assert.strictEqual(at('2026-12-01T08:00:00Z', '15:00', MALAGA), '2026-12-01T14:00:00.000Z', 'зимой Малага UTC+1');
// «Завтра» после полуночи по месту, хотя в UTC ещё вчера
assert.strictEqual(at('2026-10-04T22:30:00Z', 'завтра 11:00', MALAGA), '2026-10-06T09:00:00.000Z', 'завтра — по календарю места');
// Назавтра переводят часы (25.10.2026): уже по зимнему
assert.strictEqual(at('2026-10-24T12:00:00Z', 'завтра 11:00', MALAGA), '2026-10-25T10:00:00.000Z', 'день перевода часов');
assert.strictEqual(at('2026-10-05T08:00:00Z', '15:00', MOSCOW), '2026-10-05T12:00:00.000Z', 'Москва UTC+3');
assert.strictEqual(at('2026-10-05T08:00:00Z', '15:00', FALLBACK_TIME_ZONE), '2026-10-05T14:00:00.000Z', 'запасной UTC+1');

Settings.now = () => Date.now();
assert.strictEqual(parseWhen('сейчас', MALAGA), null);
assert.strictEqual(parseWhen('25:00', MALAGA), undefined);
assert.strictEqual(parseWhen('abc', MALAGA), undefined);

console.log('test_order_time_zone: ok');
