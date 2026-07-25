# Развёртывание и логи

## Структура исходников (кратко)

Прикладной код бота сосредоточен в **`src/engine`** (FSM, children-хендлеры, расчёт заказа, документы) и **`src/newManagers`** (оркестратор, API, транспорты в `src/transport`). Отдельные корневые папки `src/states`, `src/handlers`, `src/types`, `src/utils` убраны: их содержимое перенесено в `src/engine/types`, `src/engine/children/order`, `src/engine/children/docs`, `src/engine/utils`. Подробнее — **`src/engine/README.md`**.

## Redis: `NOAUTH Authentication required`

Значит на сервере Redis включён **`requirepass`**, а бот подключается без пароля.

- Укажите тот же пароль в **`app.json`** → `redis.password`, или
- задайте **`REDIS_PASSWORD`** в окружении / `.env` (имеет приоритет над `app.json`).

Пустая строка в JSON для пароля считается «пароля нет» — для защищённого Redis это не подойдёт.

## Два конфигурационных файла

`src/index.ts` читает **`config/app.json`** (или путь в `APP_CONFIG`): Redis, путь к файлу оркестратора, опции движка.

Секции **`api` / `bots` / `tenantOverrides`** живут во **втором** файле, например **`config/orchestrator.json`**, путь задаётся в app как `orchestrator.configPath`.

Если положить содержимое оркестратора в `app.json`, загрузчик выдаст явную ошибку. Образцы: `config/app.example.json`, `config/orchestrator.example.json`.

## Redis при старте

При запуске **`src/index.ts`** после создания `Engine` вызывается **`FLUSHDB`** для **текущей логической БД** Redis (по умолчанию `0`). Удаляются все ключи в этой БД, в том числе состояния FSM и очереди задач `engine:*:tasks`. Так проще не поддерживать восстановление сценариев после рестарта процесса.

**Важно:** если в той же БД Redis работают другие приложения, используйте отдельный номер БД (`redis-cli SELECT` / настройка клиента) или отключите сброс в `config/app.json`:

```json
"engine": {
  "flushRedisOnStartup": false
}
```

## Переменные окружения (логирование)

| Переменная | Описание |
|------------|----------|
| `LOG_LEVEL` | Уровень Winston (`error`, `warn`, `info`, `http`, `verbose`, `debug`, `silly`). По умолчанию в продакшен-логгере из `MegaLogger` — `info`, у дефолтного логгера до `registerRootLogger` — `debug`. |
| `LOG_TO_FILE` | Если `1`, дефолтный логгер до старта приложения пишет в файлы под `logs/`. Основной процесс после `registerRootLogger` в `src/index.ts` использует `MegaLogger` с записью в файлы по умолчанию. |
| `LOG_CONSOLE` | Если `0`, отключает вывод дефолтного логгера в консоль. |
| `LOG_SERVICE_NAME` | Имя сервиса в поле `service` в JSON-логах (для дефолтного логгера до регистрации корня). |
| `ORDER_MANAGER_LOG` | `1` — подробные логи **OrderManager** (регистрация заказа, тик опроса, ошибки тика). |
| `DRIVER_SEARCH_LOG` | `1` — логи **DriverSearchManager** (опрос, ошибки `getDrivers`). |
| `API_DATA_CACHE_LOG` | `1` — логи таймера **APIManager**: проверка `getCacheVersion` vs версия загруженных данных и перезагрузка `/data` при рассинхроне. |

### Фоновое обновление API data

После первой успешной загрузки `api_data_manager` у каждого **APIManager** запускается интервал **30 с**: вызывается `APIDataManager.isNewestVersion()` (сравнение с `getCacheVersion()`). Если версия на сервере новее — выполняется `load()`. Таймер останавливается при **Orchestrator.stop()**.

## Файлы

- `logs/combined.log` — все уровни от корневого логгера (включая записи с разными тегами модулей).
- `logs/error.log` — `warn` и выше.
- `logs/events.log` — **бизнес-события**, по одной JSON-строке на событие (см. ниже).
- `logs/exceptions.log`, `logs/rejections.log` — необработанные исключения и отклонения промисов (если включена запись в файлы).

## Теги модулей

Используйте `getTaggedLogger('ИмяМодуля')` или `logger.withTag('ИмяМодуля')`. Все теги пишут в **один** `combined.log`; тег попадает в поле `tag` и в префикс консольного форматтера.

## Отладка

- `CHILDREN_HANDLER_DEBUG=1` — подробные логи выбора flow в children-хендлере.
- `FSM_TRANSITION_DEBUG=1` — дамп внутреннего transition-log при ошибках перехода FSM.
- `WHATSAPP_DEBUG=1` — отладочные сообщения WhatsApp-адаптера.

## Семантические события (`events.log`)

Вызывайте `logBusinessEvent(name, meta)` из `src/addons/logger`. Примеры имён:

- `user.registered` — завершён сценарий регистрации в боте (в т.ч. восстановление после `deleted`; поле `recovered: true`).
- `order.created` — заказ создан через API, в `meta` есть `orderId`, идентификаторы пользователя/чата/бота.
- `user.account_deleted` — аккаунт помечен удалённым из настроек.
