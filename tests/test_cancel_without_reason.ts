/**
 * «0 — Не хочу сообщать» в списке причин отмены отменяет заказ без причины,
 * а не отвечает «команда не распознана».
 *
 * Запуск: ./node_modules/.bin/ts-node -T tests/test_cancel_without_reason.ts
 */
import assert from 'assert';
import order from '../src/engine/schemas/children/order.json';
import { handleCancelOrderWithReason } from '../src/engine/handlers/children/actions/OrderActions';

async function main() {
  const state: any = (order as any).states?.cancelReason ?? (order as any).cancelReason;

  // --- 1. «0» ведёт в отмену и в главное меню ---
  {
    const event = state.validation.mapping['0'].event;
    const tr = state.transitions.find((t: any) => t.event === event);
    assert.ok(tr, 'нет перехода для ' + event);
    assert.strictEqual(tr.to, 'main.default');
    assert.deepStrictEqual(tr.actions, ['cancelOrderWithReason', 'sendCloseReasonSpecified']);
    console.log('✅ Test 1: «0» → отмена заказа и главное меню');
  }

  // --- 2. В API уходит отмена с пустой причиной ---
  {
    const calls: any[] = [];
    const ctx: any = {
      tenantId: 'children',
      input: '0',
      getIdField: () => ({ u_a_tg: '12345' }),
      getData: async () => ({ user: { lang: '1' }, order: { id: 4200 } }),
      getLocalizedText: async (k: string) => 'TEXT:' + k,
      apiManager: { cancelOrder: async (...args: any[]) => { calls.push(args); return true; } },
    };
    await handleCancelOrderWithReason(ctx);
    assert.deepStrictEqual(calls, [['4200', '', { u_a_tg: '12345' }]]);
    console.log('✅ Test 2: заказ отменён без причины');
  }

  console.log('\nВсе тесты пройдены');
}

main().catch((e) => { console.error(e); process.exit(1); });
