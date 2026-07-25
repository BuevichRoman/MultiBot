/**
 * Точка входа продакшена: тенант **children** — Telegram + WhatsApp Web (по конфигу).
 *
 * 1. Скопируйте `config/app.example.json` → `config/app.json`
 * 2. Скопируйте `config/orchestrator.example.json` → `config/orchestrator.json` и заполните токены/URL
 * 3. `npm run build && npm start`
 *
 * Путь к app-конфигу: переменная `APP_CONFIG` или `config/app.json` в корне репозитория.
 */
import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import Engine from './engine';
import { Orchestrator } from './newManagers/orchestrator/Orchestrator';
import defaultLogger, { MegaLogger, registerRootLogger } from './addons/logger';
import { makeChildrenHandler } from './engine/handlers/children';
import { loadAppConfig, resolveFromRepo } from './config/loadAppConfig';

const TENANT_ID = 'children';

async function main(): Promise<void> {
    const cwd = process.cwd();
    const appConfigPath = process.env.APP_CONFIG || path.join(cwd, 'config', 'app.json');

    if (!fs.existsSync(appConfigPath)) {
        defaultLogger.error(
            `[bootstrap] Нет файла ${appConfigPath}. Скопируйте config/app.example.json → config/app.json`,
        );
        process.exit(1);
    }

    const app = loadAppConfig(appConfigPath);
    const orchestratorConfigPath = resolveFromRepo(cwd, app.orchestrator.configPath);

    if (!fs.existsSync(orchestratorConfigPath)) {
        defaultLogger.error(
            `[bootstrap] Нет оркестратор-конфига: ${orchestratorConfigPath}. См. config/orchestrator.example.json`,
        );
        process.exit(1);
    }

    const redisPasswordFromEnv = process.env.REDIS_PASSWORD?.trim();
    const redisPasswordFromFile =
        app.redis.password != null && String(app.redis.password).trim() !== ''
            ? String(app.redis.password)
            : undefined;
    const redis = {
        ...app.redis,
        /** Переменная окружения перекрывает app.json (удобно не светить пароль в файле). */
        password: redisPasswordFromEnv || redisPasswordFromFile,
    };

    const schemasPath = app.engine?.schemasPath
        ? resolveFromRepo(cwd, app.engine.schemasPath)
        : path.join(cwd, 'src', 'engine', 'schemas');

    const logger = new MegaLogger({
        serviceName: app.logging?.serviceName ?? 'taxi-bot-children',
    });
    registerRootLogger(logger);

    const engine = new Engine({
        redis,
        schemasPath,
        flushRedisOnStartup: app.engine?.flushRedisOnStartup,
    });
    await engine.flushRedisOnColdStart();

    const orchestrator = new Orchestrator({
        configSource: orchestratorConfigPath,
        logger,
        autoStart: false,
        skipApiLogin: app.orchestrator.skipApiLogin ?? false,
        engine,
    });

    await orchestrator.registerTenantHandler(TENANT_ID, (orch, eng, apiManager) => {
        return makeChildrenHandler(orch, eng, apiManager);
    });

    await orchestrator.start();

    logger.info('[bootstrap] Orchestrator started (children: Telegram + WhatsApp по JSON-конфигу)');

    const shutdown = async (signal: string) => {
        logger.warn(`[bootstrap] Shutdown ${signal}`);
        await orchestrator.stop(signal);
        process.exit(0);
    };

    process.on('SIGINT', () => {
        void shutdown('SIGINT');
    });
    process.on('SIGTERM', () => {
        void shutdown('SIGTERM');
    });
}

main().catch((err: unknown) => {
    const message = err instanceof Error ? err.message : String(err);
    const stack = err instanceof Error ? err.stack : undefined;
    defaultLogger.error('[bootstrap] Fatal', { message, stack });
    process.exit(1);
});
