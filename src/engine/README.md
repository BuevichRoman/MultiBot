Engine (hybrid FSM + TaskManager)
=================================

Overview
--------
This folder contains a simple prototype of the engine discussed previously: a hybrid FSM model (declarative JSON per-tenant) plus a minimal TaskManager backed by Redis.

Structure
- `types.ts` — схема тенанта FSM (состояния, действия, переходы).
- `types/Location.ts`, `types/OrderPrice.ts` — общие типы для заказа/гео (раньше были в `src/states`, `src/types`).
- `utils/formatString.ts` — `%placeholder%` в строках.
- `redisClient.ts` — фабрика `ioredis`.
- `managers/FSMManager.ts` — схемы тенантов и состояние в Redis.
- `managers/TaskManager.ts` — очередь задач (BRPOP).
- `index.ts` — сборка Engine.
- `schemas/` — JSON-схемы по тенантам.
- `children/order/` — расчёт цены и текст подтверждения (`priceCalculation.ts`, `orderConfirmation.ts`).
- `children/docs/` — документы бота (`legalDocUtils.ts`, `docsHelpers.ts`).
- `handlers/children/` — обработка сообщений tenant **children** и экшены FSM.

Tenant schema format (brief)
- `tenantId`: string
- `initialState`: state id
- `states`: map of state id -> `{ id, entryActions?, transitions? }`
- `transitions`: array of `{ event, to, actions? }`
- `actions`: map of action name -> `{ type, params? }`

Продакшен-сборка использует **`config/app.json`** и Orchestrator — см. репозиторий **[docs/DEPLOYMENT.md](../../docs/DEPLOYMENT.md)**.

How to use (example)
1. Start Redis (host/port/password as in your environment).
2. Create an Engine instance and load a tenant schema:

```ts
import Engine from '../src/engine';

const engine = new Engine({ redis: { host: '127.0.0.1', port: 6379, password: 'REDACTED-REDIS-PASSWORD' } });
await engine.loadTenantSchema('example_tenant');

// get managers
const fsm = engine.getFSMManager();
const task = engine.getTaskManager();
```

3. Use `fsm.transition(tenantId, chatId, event)` to move state and get actions to execute. Actions are declarative keys — the host application (Orchestrator) should map action types to actual code (send messages, persist data, enqueue tasks, etc.).

Next steps
- Hook the engine into `Orchestrator` so incoming messages run `fsm.transition` and the returned actions are executed by adapters or task workers.
- Implement richer action types and an action registry to map declarative actions to code.
- Add tests that use `src/transport/TestAdapter` to validate flows.
