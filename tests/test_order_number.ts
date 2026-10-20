import assert from 'assert';
import { withOrderNumber } from '../src/engine/children/order/orderNumber';

const noNannies = '🙆‍♀️  _*СОЖАЛЕЕМ, СВОБОДНЫХ НЯНЬ СЕЙЧАС В НАЛИЧИИ НЕТ*_\n\n_*Ваш заказ отменен.* Попробуйте сделать заказ немного позже._';

assert.strictEqual(withOrderNumber(noNannies, 4157, '1'), noNannies + '\n\nЗаказ № 4157');
assert.strictEqual(withOrderNumber('Order cancelled.', '4157', '2'), 'Order cancelled.\n\nOrder # 4157');
assert.strictEqual(withOrderNumber('Заказ %order% отменён', 4157, '1'), 'Заказ 4157 отменён');
assert.strictEqual(withOrderNumber(noNannies, undefined, '1'), noNannies, 'без номера текст не меняется');
assert.strictEqual(withOrderNumber(noNannies, '', '1'), noNannies);

console.log('test_order_number: ok');
