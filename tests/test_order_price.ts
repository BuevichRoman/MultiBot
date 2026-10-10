/**
 * Цену считает сервер (шаблон nanny_pricing): бот только спрашивает её и
 * создаёт заказ через шаблон с ключом запроса, чтобы повтор не дал второй заказ.
 *
 * Запуск: ./node_modules/.bin/ts-node -T tests/test_order_price.ts
 */
import assert from 'assert';
import axios from 'axios';
import { calculateOrderPriceChildren, finalOrderPriceChildren } from '../src/engine/children/order/orderConfirmation';
import { handleCreateOrder } from '../src/engine/handlers/children/actions/OrderActions';
import { APIManager } from '../src/newManagers/api/APIManager';

const MALAGA = { latitude: 36.72, longitude: -4.42 };
const SERVER_PRICE = {
  formula: '(base_price+distance*price_per_km+duration*price_per_minute)*time_ratio*car_class_ratio+options_sum+submit_price',
  price: 180,
  options: { base_price: 200, time_ratio: 0.5, options_sum: 80 },
  calculationType: 'incomplete',
};

function fakeApi(answer: any) {
  const calls: any[] = [];
  return {
    calls,
    pricingTemplate: async (payload: any, idField?: any) => {
      calls.push({ payload, idField });
      if (answer instanceof Error) throw answer;
      return { status: 200, data: answer };
    },
  };
}

async function main() {
  // --- 1. Цена до заказа — вопрос серверу с часом начала, поясом и опциями ---
  {
    const api = fakeApi({ status: 'success', data: SERVER_PRICE });
    const pm = await calculateOrderPriceChildren(api, MALAGA, [1], new Date('2026-07-01T20:30:00Z'));
    assert.deepStrictEqual(api.calls[0].payload, {
      action: 'quote', when: '2026-07-01T20:30:00.000Z', time_zone: 'Europe/Madrid', options: [1],
    });
    assert.strictEqual(pm.price, '180');
    assert.strictEqual(pm.formula, SERVER_PRICE.formula);
    console.log('✅ Test 1: quote — час начала, пояс места заказа, опции; цена от сервера');
  }

  // --- 2. Сервер не ответил ценой — «цены нет», а не своя копия расчёта ---
  {
    for (const answer of [{ status: 'error', message: 'pricing model not configured' }, new Error('ETIMEDOUT')]) {
      const pm = await calculateOrderPriceChildren(fakeApi(answer), MALAGA, [], null);
      assert.deepStrictEqual(pm, { formula: '-', price: '0', options: {}, calculationType: 'incomplete' });
    }
    console.log('✅ Test 2: ошибка шаблона — цены нет, клиентского расчёта нет');
  }

  // --- 3. Итог — по номеру заказа, от имени клиента ---
  {
    const api = fakeApi({ status: 'success', data: { ...SERVER_PRICE, price: 480 } });
    const pm = await finalOrderPriceChildren(api, 4300, { u_a_tg: '1' });
    assert.deepStrictEqual(api.calls[0], { payload: { action: 'final', b_id: 4300 }, idField: { u_a_tg: '1' } });
    assert.strictEqual(pm.price, '480');
    console.log('✅ Test 3: final — по b_id');
  }

  // --- 4. createDrive идёт в шаблон create; цену в заказ кладёт сервер ---
  const self: any = {
    url: 'http://x', adminAuth: { token: 't', u_hash: 'h' }, tag: '[t]',
    logger: { info() {}, warn() {}, error() {}, debug() {} },
  };
  self.pricingTemplate = APIManager.prototype.pricingTemplate;
  const draft = {
    from: { latitude: '36.72', longitude: '-4.42' }, to: { latitude: '36.72', longitude: '-4.42' },
    when: new Date('2026-07-01T20:00:00Z'), childrenCount: 3, preferredDriversList: ['887'],
    requestKey: 'req-0001-abcdef', timeZone: 'Europe/Madrid',
  };
  {
    const posts: Array<{ url: string; fields: Record<string, any> }> = [];
    (axios as any).post = async (url: string, form: any) => {
      posts.push({ url, fields: Object.fromEntries(form.entries()) });
      return { status: 200, data: { status: 'success', data: { b_id: 4300, duplicate: false } } };
    };
    const r = await APIManager.prototype.createDrive.call(self, draft, { u_a_tg: '1' });
    assert.deepStrictEqual(r, { orderId: 4300 });
    assert.strictEqual(posts[0].url, 'http://x/script/template/nanny_pricing');
    assert.strictEqual(posts[0].fields.is_var, '1');
    assert.strictEqual(posts[0].fields.u_a_tg, '1');
    const s = JSON.parse(posts[0].fields.s_t_data);
    assert.strictEqual(s.action, 'create');
    assert.strictEqual(s.request_key, 'req-0001-abcdef');
    assert.strictEqual(s.time_zone, 'Europe/Madrid');
    assert.strictEqual(s.order.b_start_datetime, '2026-07-01 20:00:00+00:00');
    assert.strictEqual(s.order.b_options.pricingModel, undefined, 'цену в заказ пишет сервер');
    assert.strictEqual(s.order.b_options.childrenProfiles, '3');
    assert.ok(posts.some((p) => p.url === 'http://x/drive/get/4300' && p.fields.action === 'set_offer'), 'оффер няне');
    console.log('✅ Test 4: create через шаблон, без своей цены, оффер няне отправлен');
  }

  // --- 5. Повтор (duplicate) — тот же заказ, офферы второй раз не шлём ---
  {
    const posts: string[] = [];
    (axios as any).post = async (url: string) => {
      posts.push(url);
      return { status: 200, data: { status: 'success', data: { b_id: 4300, duplicate: true } } };
    };
    const r = await APIManager.prototype.createDrive.call(self, draft, { u_a_tg: '1' });
    assert.deepStrictEqual(r, { orderId: 4300 });
    assert.deepStrictEqual(posts, ['http://x/script/template/nanny_pricing']);
    console.log('✅ Test 5: повтор — тот же заказ, офферы не дублируются');
  }

  // --- 6. Создание заказа берёт ключ из подтверждения ---
  {
    const drafts: any[] = [];
    const ctx: any = {
      tenantId: 'children', userId: 'u', chatId: 'c', botId: 'b',
      getIdField: () => ({ u_a_tg: '1' }),
      getData: async () => ({
        user: { lang: '1' },
        order: { calculated: { requestKey: 'from-confirmation-1' }, input: { latitude: 36.72, longitude: -4.42, when: null, childrenCount: 2 } },
      }),
      mergeData: async () => {},
      sendMessage: async () => {},
      getLocalizedText: async (k: string) => k,
      apiManager: { createDrive: async (d: any) => { drafts.push(d); return { orderId: 4301 }; } },
    };
    await handleCreateOrder(ctx);
    assert.strictEqual(drafts[0].requestKey, 'from-confirmation-1');
    assert.strictEqual(drafts[0].timeZone, 'Europe/Madrid');
    console.log('✅ Test 6: ключ запроса — из показанного подтверждения');
  }

  console.log('\nВсе тесты пройдены');
}

main().catch((e) => { console.error(e); process.exit(1); });
