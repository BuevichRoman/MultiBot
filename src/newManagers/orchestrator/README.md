# Orchestrator

Загружает **`RootConfig`** (секции `api`, `bots`, опционально `tenantOverrides`) из файла или объекта через `AsyncConfigurationOrchestrator`.

## Продакшен

Используйте корневой **`src/index.ts`**: он читает `config/app.json` и путь к оркестратор-конфигу (`config/orchestrator.json` по умолчанию). См. **`docs/DEPLOYMENT.md`**.

## Программный запуск (тесты)

Передайте в конструктор `Orchestrator` объект `RootConfig` или путь к JSON — см. `tests/test_adapter_neworch.ts`.
