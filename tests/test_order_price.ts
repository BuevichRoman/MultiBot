/**
 * Цена заказа: дневной/ночной тариф по часу начала заказа в поясе места
 * заказа, и в заказ уходит та же цена, что клиент видел в подтверждении.
 *
 * Запуск: ./node_modules/.bin/ts-node -T tests/test_order_price.ts
 */
import assert from 'assert';
import axios from 'axios';
import { calculateOrderPriceChildren } from '../src/engine/children/order/orderConfirmation';
import { APIManager } from '../src/newManagers/api/APIManager';

const MALAGA = { latitude: 36.72, longitude: -4.42 };
const pricingModels = {
  version: '1.0',
  pricing_models: {
    basic: {
      constants: {
        base_price: 200, price_per_km: 10, price_per_minute: 5,
        time_ratio: { night: 0.5, day: 1 },
      },
      model: { expression: '(base_price+distance*price_per_km+duration*price_per_minute)*time_ratio*car_class_ratio+options_sum+submit_price' },
    },
  },
};
const apiManager = {
  api_data_manager: { data: { data: { site_constants: { pricingModels: { value: JSON.stringify(pricingModels) } }, booking_comments: {} } } },
};

const price = async (when: Date | null) =>
  (await calculateOrderPriceChildren(apiManager, MALAGA, MALAGA, [], false, when)).price;

async function main() {
  // --- 1. Летом в Малаге 06:30 — уже день (в UTC+1 было бы 05:30, ночь) ---
  assert.strictEqual(await price(new Date('2026-07-01T04:30:00Z')), '200');
  console.log('✅ Test 1: 06:30 по Мадриду — дневной тариф');

  // --- 2. 21:30 по Мадриду — ночь (в UTC+1 было бы 20:30, день) ---
  assert.strictEqual(await price(new Date('2026-07-01T19:30:00Z')), '100');
  console.log('✅ Test 2: 21:30 по Мадриду — ночной тариф');

  // --- 3. Зимой пояс другой: 06:30 CET = 05:30Z — день ---
  assert.strictEqual(await price(new Date('2026-12-01T05:30:00Z')), '200');
  console.log('✅ Test 3: зимнее время учтено');

  // --- 4. Цена из подтверждения уходит в заказ, а не снимок «200» ---
  {
    let sent: any = null;
    (axios as any).post = async (_url: string, form: any) => {
      sent = JSON.parse(typeof form.get === 'function' ? form.get('data') : form.data);
      return { status: 200, data: { status: 'success', data: { b_id: 4300 } } };
    };
    const self: any = {
      url: 'http://x', adminAuth: { token: 't', u_hash: 'h' }, tag: '[t]',
      logger: { info() {}, warn() {}, error() {}, debug() {} },
    };
    const pricingModel = await calculateOrderPriceChildren(apiManager, MALAGA, MALAGA, [], false,
      new Date('2026-07-01T20:00:00Z'));
    const r = await APIManager.prototype.createDrive.call(self, {
      from: { latitude: '36.72', longitude: '-4.42' }, to: { latitude: '36.72', longitude: '-4.42' },
      when: new Date('2026-07-01T20:00:00Z'), childrenCount: 3, pricingModel,
    }, { u_a_tg: '1' });
    assert.deepStrictEqual(r, { orderId: 4300 });
    assert.strictEqual(sent.b_options.pricingModel.price, '100');
    assert.strictEqual(sent.b_options.pricingModel.options.time_ratio, 0.5);
    assert.strictEqual(sent.b_options.childrenProfiles, '3');
    console.log('✅ Test 4: в заказ записана цена из подтверждения');
  }

  console.log('\nВсе тесты пройдены');
}

main().catch((e) => { console.error(e); process.exit(1); });
