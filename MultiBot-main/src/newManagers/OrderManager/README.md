# OrderManager

Менеджер наблюдения за заказами: один экземпляр на tenant, обслуживает все активные заказы тенанта. Опрашивает API, при смене статуса или по таймауту отправляет **system event** в тот же пайплайн, что и сообщения от адаптеров (с пометкой `ctx.isSystemEvent`).

## Назначение

- **Реестр заказов** — какие заказы сейчас на наблюдении (orderId, botId, chatId, контекст).
- **Цикл опроса** — раз в N секунд запрос к API за состоянием каждого заказа.
- **Таймаут ожидания** — если прошло больше `maxWaitingSecs` (например 10 мин), заказ отменяется через API и в движок уходит событие `order_status_out_of_time`.
- **События в JSON-движок** — при смене статуса (водитель назначен, приехал, поездка началась/завершена, отмена и т.д.) вызывается `onSystemEvent`; оркестратор формирует `ctx` с `isSystemEvent: true` и `event` и вызывает тот же tenant handler.

Тексты сообщений пользователю задаются не в менеджере, а в JSON-схеме (actions `sendL10n` по переходам на эти события).

## Структура

```
OrderManager/
  types.ts      — типы, ORDER_STATUS_EVENTS, RawOrderData, OrderWatchEntry, конфиг
  OrderManager.ts — класс OrderManager
  index.ts      — реэкспорт
  README.md     — эта документация
```

## Типы и контракты

### События статуса (`ORDER_STATUS_EVENTS`)

| Событие | Описание |
|--------|----------|
| `order_status_processing` | Заказ в обработке |
| `order_status_approved` | Водитель назначен |
| `order_status_driver_arrived` | Водитель приехал |
| `order_status_driver_started` | Поездка началась |
| `order_status_driver_canceled` | Водитель отменил |
| `order_status_canceled` | Заказ отменён |
| `order_status_completed` | Заказ завершён |
| `order_status_out_of_time` | Превышено время ожидания (менеджер сам отменяет заказ) |

Терминальные события (после них заказ снимается с наблюдения): `completed`, `canceled`, `driver_canceled`, `out_of_time`.

### Конфиг (`OrderManagerConfig`)

- **getOrderState(orderId)** — вернуть сырые данные заказа с API (`RawOrderData`) или `null` при ошибке/ненайденном заказе.
- **cancelOrder(orderId, reason)** — отменить заказ (вызывается при таймауте).
- **onSystemEvent(payload)** — вызвать при смене статуса; оркестратор превращает `payload` в `ctx` и вызывает tenant handler.
- **defaultPollIntervalMs** — интервал опроса по умолчанию (мс), например 5000.

### Постановка на наблюдение (`RegisterOrderOptions`)

- **orderId**, **botId**, **chatId** — обязательно.
- **userId**, **lang** — по желанию (для контекста в handler).
- **maxWaitingSecs** — макс. время ожидания в секундах (по умолчанию 600 = 10 мин); по истечении — отмена и `order_status_out_of_time`.
- **pollIntervalMs** — интервал опроса для этого заказа (если не задан — из конфига).
- **meta** — произвольные данные.

## API класса OrderManager

| Метод | Описание |
|-------|----------|
| `registerOrder(orderId, opts)` | Поставить заказ на наблюдение |
| `unregisterOrder(orderId)` | Снять заказ с наблюдения |
| `getOrderDetails(orderId)` | Детали из реестра (без запроса к API) |
| `getActiveOrderIds()` | Список всех наблюдаемых orderId |
| `setPollInterval(orderId, ms)` | Интервал опроса для одного заказа |
| `setDefaultPollInterval(ms)` | Интервал по умолчанию для новых заказов |
| `start()` | Запустить цикл опроса (вызывается оркестратором при старте) |
| `stop()` | Остановить цикл |

## Интеграция с Orchestrator

- При **start()** оркестратор для каждого tenant’а с зарегистрированным handler создаёт `OrderManager`, подставляет `getOrderState`/`cancelOrder` из `APIManager` и `onSystemEvent` → `orchestrator.emitSystemEvent(tenantId, payload)`.
- **emitSystemEvent** формирует `ctx` как у адаптеров, но с `isSystemEvent: true`, `event: payload.event`, `payload: payload.payload` и вызывает тот же tenant handler.
- Доступ к менеджеру: **orchestrator.getOrderManager(tenantId)**.
- После успешного создания заказа (например в action `createOrder`) нужно вызвать:
  `orchestrator.getOrderManager('children').registerOrder(orderId, { botId, chatId, userId, maxWaitingSecs: 600, ... })`.

## Обработка в tenant handler (JSON-движок)

В handler’е нужно различать источник:

- **ctx.isSystemEvent === true** — не определять событие из текста; делать `fsm.transition(tenantId, chatId, ctx.event)` и выполнять actions из схемы.
- Иначе — как обычно: валидация/парсинг текста → событие → transition.

В JSON-схеме (например `order` flow) для событий `order_status_*` задаются переходы и actions (в т.ч. `sendL10n` с нужными ключами).

## Формат данных API (`RawOrderData`)

Ожидается структура ответа вида drive/get:

- **b_state** — состояние заказа (1, 2, 3, 4, 6 и т.д.).
- **drivers** — массив водителей с полями `c_appointed`, `c_arrived`, `c_started`, `c_canceled`, `c_completed` (время или null).
- **b_start_datetime**, **b_max_waiting_list** — опционально (для расширенной проверки таймаута; сейчас таймаут считается по `registeredAt + maxWaitingSecs` в реестре).

Маппинг в событие FSM выполняется внутри менеджера (логика из старого `api/order.ts` getState).

## Логи

По умолчанию OrderManager **ничего не пишет** в логгер. Включить: **`ORDER_MANAGER_LOG=1`** (регистрация заказа, тик, ошибки опроса).

## Производительность

- Один общий `setInterval` на весь tenant; за один тик опрашиваются все активные заказы по очереди.
- При большом числе заказов можно увеличить интервал или вынести опрос в очередь задач (отдельная доработка).
