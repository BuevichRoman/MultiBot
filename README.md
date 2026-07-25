# TaxiBotRefact

Боты **Telegram** и **WhatsApp Web** для тенанта **`children`** (FSM на Redis, оркестратор, API такси).

## Быстрый старт

1. Скопируйте `config/app.example.json` → `config/app.json`, `config/orchestrator.example.json` → `config/orchestrator.json`.
2. Заполните Redis, URL API, токен Telegram, при необходимости `sessionDir` для WhatsApp.
3. `npm install && npm run build && npm start`

Подробно: **[docs/DEPLOYMENT.md](docs/DEPLOYMENT.md)**.

## Разработка

```bash
npm run dev
```

Отладка flow children: `CHILDREN_HANDLER_DEBUG=1`.

## Структура

| Путь | Назначение |
|------|------------|
| `src/index.ts` | Продакшен-вход: Engine + Orchestrator + children |
| `src/engine/` | FSM, схемы в `schemas/children/` |
| `src/newManagers/orchestrator/` | Загрузка JSON-конфига, старт адаптеров |
| `config/` | Примеры конфигов; рабочие `app.json` / `orchestrator.json` в `.gitignore` |
