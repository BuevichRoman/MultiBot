# Поля `config/app.json`

| Поле | Описание |
|------|-----------|
| `redis` | Подключение ioredis для FSM и TaskManager (`host`, `port`, опционально `password`) |
| `engine.schemasPath` | Каталог со схемами тенантов (от корня репозитория) |
| `orchestrator.configPath` | JSON с API и ботами (см. `orchestrator.example.json`) |
| `orchestrator.skipApiLogin` | Если `true`, не вызывать `loginAdmin` при старте (только отладка) |
| `logging.serviceName` | Имя сервиса в MegaLogger |

Переменная окружения `APP_CONFIG` переопределяет путь к `app.json` (по умолчанию `config/app.json` в корне проекта).
