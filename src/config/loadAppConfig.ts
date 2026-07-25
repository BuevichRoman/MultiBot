import fs from 'fs';
import path from 'path';

/** Содержимое `config/app.json` (Redis, пути, опции оркестратора). */
export interface AppConfigFile {
    redis: {
        host: string;
        port: number;
        password?: string;
    };
    engine?: {
        schemasPath?: string;
        /** false — не вызывать FLUSHDB при старте (если Redis делит БД с другими приложениями). */
        flushRedisOnStartup?: boolean;
    };
    orchestrator: {
        /** Путь к JSON с `api` + `bots` (от корня репозитория или абсолютный). */
        configPath: string;
        skipApiLogin?: boolean;
    };
    logging?: {
        serviceName?: string;
    };
}

function looksLikeOrchestratorRoot(data: unknown): boolean {
    if (!data || typeof data !== 'object') return false;
    const o = data as Record<string, unknown>;
    return 'api' in o && 'bots' in o && !('redis' in o);
}

export function loadAppConfig(filePath: string): AppConfigFile {
    const raw = fs.readFileSync(filePath, 'utf-8');
    const data = JSON.parse(raw) as AppConfigFile;

    if (looksLikeOrchestratorRoot(data)) {
        throw new Error(
            `app config (${filePath}): файл похож на конфиг оркестратора (поля api, bots). ` +
                `Для src/index.ts нужен другой формат: redis + orchestrator.configPath. ` +
                `Вынесите api/bots в отдельный JSON (например config/orchestrator.json) и укажите путь в app.json. ` +
                `См. config/app.example.json в репозитории.`,
        );
    }

    if (!data.redis?.host || data.redis.port == null) {
        throw new Error(`app config: invalid redis section in ${filePath}`);
    }
    if (!data.orchestrator?.configPath) {
        throw new Error(`app config: orchestrator.configPath required in ${filePath}`);
    }
    return data;
}

/** Разрешить путь относительно cwd, если он не абсолютный. */
export function resolveFromRepo(cwd: string, p: string): string {
    return path.isAbsolute(p) ? p : path.join(cwd, p);
}
