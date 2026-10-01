/**
 * Нянь не нашли — заказ всё равно записывается и сразу отменяется с причиной,
 * чтобы отказ был виден в админке.
 *
 * Запуск: ./node_modules/.bin/ts-node -T tests/test_record_unserved_order.ts
 */
import assert from 'assert';
import {
    handleRecordUnservedOrder,
    NO_NANNIES_CANCEL_REASON,
} from '../src/engine/handlers/children/actions/OrderActions';

type Call = { method: string; args: any[] };

function makeCtx(input: Record<string, any>, api: { createResult?: any; cancelOk?: boolean } = {}) {
    const calls: Call[] = [];
    const sent: string[] = [];
    const ctx: any = {
        tenantId: 'children',
        userId: 'u1',
        chatId: 'c1',
        botId: 'b1',
        getIdField: () => ({ u_a_tg: '12345' }),
        getData: async () => ({ user: { lang: '1' }, order: { input } }),
        sendMessage: async (t: string) => { sent.push(t); },
        apiManager: {
            createDrive: async (...args: any[]) => {
                calls.push({ method: 'createDrive', args });
                return api.createResult ?? { orderId: 4200 };
            },
            cancelOrder: async (...args: any[]) => {
                calls.push({ method: 'cancelOrder', args });
                return api.cancelOk ?? true;
            },
        },
    };
    return { ctx, calls, sent };
}

const INPUT = {
    noDriversReason: 'no_drivers',
    latitude: 36.728617,
    longitude: -4.434942,
    when: '2026-10-01T08:00:00.000Z',
    hoursCount: 3,
    childrenCount: 1,
    additionalOptions: [2],
    preferredDriversList: ['887'],
    plannedBreaks: [],
};

async function main() {
    // --- 1. Создаёт заказ и сразу отменяет его с причиной ---
    {
        const { ctx, calls, sent } = makeCtx(INPUT);
        await handleRecordUnservedOrder(ctx);
        assert.deepStrictEqual(calls.map((c) => c.method), ['createDrive', 'cancelOrder']);
        const [draft, idField] = calls[0].args;
        assert.deepStrictEqual(draft.from, { latitude: '36.728617', longitude: '-4.434942' });
        assert.strictEqual((draft.when as Date).toISOString(), '2026-10-01T08:00:00.000Z');
        assert.strictEqual(draft.hoursCount, 3);
        assert.deepStrictEqual(draft.additionalOptions, [2]);
        assert.deepStrictEqual(draft.preferredDriversList, [], 'офферы няням не рассылаем');
        assert.deepStrictEqual(idField, { u_a_tg: '12345' });
        assert.deepStrictEqual(calls[1].args, ['4200', NO_NANNIES_CANCEL_REASON, { u_a_tg: '12345' }]);
        assert.strictEqual(sent.length, 0, 'клиенту ничего лишнего не пишем');
        console.log('✅ Test 1: заказ создан и отменён с причиной «' + NO_NANNIES_CANCEL_REASON + '»');
    }

    // --- 2. Без координат ничего не создаём ---
    {
        const { ctx, calls } = makeCtx({ ...INPUT, latitude: undefined });
        await handleRecordUnservedOrder(ctx);
        assert.strictEqual(calls.length, 0);
        console.log('✅ Test 2: без координат заказ не создаётся');
    }

    // --- 3. Создание не удалось — отменять нечего ---
    {
        const { ctx, calls } = makeCtx(INPUT, { createResult: { error: 'boom' } });
        await handleRecordUnservedOrder(ctx);
        assert.deepStrictEqual(calls.map((c) => c.method), ['createDrive']);
        console.log('✅ Test 3: ошибка создания — без отмены');
    }

    // --- 4. Отмена не прошла — диалог не падает ---
    {
        const { ctx, calls } = makeCtx(INPUT, { cancelOk: false });
        await handleRecordUnservedOrder(ctx);
        assert.deepStrictEqual(calls.map((c) => c.method), ['createDrive', 'cancelOrder']);
        console.log('✅ Test 4: неудачная отмена не роняет диалог');
    }

    // --- 5. Поиск прерван, а не «нянь нет» — ничего не записываем ---
    for (const reason of ['search_cancelled', 'no_coords', 'no_time', undefined]) {
        const { ctx, calls } = makeCtx({ ...INPUT, noDriversReason: reason });
        await handleRecordUnservedOrder(ctx);
        assert.strictEqual(calls.length, 0, `reason=${reason}`);
    }
    console.log('✅ Test 5: прерванный поиск заказ не записывает');

    console.log('\n🎉 Все тесты записи ненайденных заказов пройдены!');
}

main().catch((e) => {
    console.error('❌', e.message);
    process.exit(1);
});
