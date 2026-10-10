/**
 * Формула цены считается без eval и даёт то же, что считал eval.
 *
 * Запуск: ./node_modules/.bin/ts-node -T tests/test_price_formula.ts
 */
import assert from 'assert';
import { calculatePrice, evaluateFormula } from '../src/engine/children/order/priceCalculation';

const BASIC = '(base_price+distance*price_per_km+duration*price_per_minute)*time_ratio*car_class_ratio+options_sum+submit_price';
const P = { base_price: 200, distance: 3.5, price_per_km: 10, duration: 120, price_per_minute: 5,
  time_ratio: 0.5, car_class_ratio: '1.5', options_sum: 15, submit_price: 0 };

function viaEval(f: string, p: Record<string, any>) {
  let e = f;
  for (const [k, v] of Object.entries(p)) e = e.replace(new RegExp(k, 'g'), String(v));
  return Math.trunc(eval(e)).toString();
}

function main() {
  // --- 1. Совпадает с прежним eval на боевой формуле и на вариантах ---
  for (const f of [BASIC, 'base_price*-1+options_sum', '-(base_price-options_sum)/2', '1.5e2+base_price', 'base_price/3']) {
    assert.strictEqual(calculatePrice(f, P), viaEval(f, P), f);
  }
  assert.strictEqual(calculatePrice(BASIC, P), '641');
  console.log('✅ Test 1: результат совпадает с eval');

  // --- 2. Не арифметика — не исполняется, цена 0 ---
  for (const f of ['process.exit(1)', 'base_price;1', 'base_price**2', '(base_price', 'base_price+', 'alert`1`', 'unknown_var+1', 'base_price/0']) {
    assert.strictEqual(calculatePrice(f, P), '0', f);
  }
  console.log('✅ Test 2: код, ошибки синтаксиса и деление на 0 дают 0');

  // --- 3. Переменная без значения — ошибка, а не ноль ---
  assert.throws(() => evaluateFormula('base_price+x', { base_price: 1, x: null }));
  console.log('✅ Test 3: пустая переменная не превращается в 0 молча');

  console.log('\nВсе тесты пройдены');
}

try {
  main();
} catch (e) {
  console.error(e);
  process.exit(1);
}
