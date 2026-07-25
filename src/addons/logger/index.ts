/**
 * Центральный логгер на Winston: консоль + `logs/combined.log` + `logs/error.log` + **события** в `logs/events.log`.
 *
 * - **Тег модуля**: `logger.withTag('APIManager')` или `getTaggedLogger('FSM')` — поле `tag` в JSON и префикс в консоли.
 * - **Бизнес-события**: `logBusinessEvent('user.registered', { userId, ... })` — строка JSON в `events.log` + запись в combined.
 */
import winston from 'winston';
import path from 'path';
import fs from 'fs';

export interface LoggerConfig {
    serviceName?: string;
    logToFile?: boolean;
    logDir?: string;
    logLevel?: string;
    maxFiles?: string | number;
    maxSize?: string | number;
    consoleOutput?: boolean;
    /** Внутренний: дочерний winston-логгер (общие транспорты с корнем) */
    _parentWinston?: winston.Logger;
}

/** Корневой экземпляр после старта приложения (`registerRootLogger` из `src/index.ts`). */
let rootLoggerInstance: MegaLogger | null = null;

export function registerRootLogger(instance: MegaLogger): void {
    rootLoggerInstance = instance;
}

export function getRootLogger(): MegaLogger {
    return rootLoggerInstance ?? defaultLogger;
}

/** Логгер с постоянным тегом модуля (один файл combined.log для всех тегов). */
export function getTaggedLogger(tag: string): MegaLogger {
    return getRootLogger().withTag(tag);
}

/**
 * Семантические события для аналитики / мониторинга (регистрация, заказ и т.д.).
 * Пишет JSON-строку в `events.log` и дублирует в основной лог.
 */
export function logBusinessEvent(event: string, meta: Record<string, unknown> = {}): void {
    getRootLogger().audit(event, meta);
}

class MegaLogger {
    private logger: winston.Logger;
    private serviceName: string;
    readonly logDir: string;
    private readonly isRoot: boolean;

    constructor(config: LoggerConfig = {}) {
        this.serviceName = config.serviceName || 'App';
        this.logDir = config.logDir || path.join(process.cwd(), 'logs');

        if (config._parentWinston) {
            this.logger = config._parentWinston;
            this.isRoot = false;
            return;
        }

        this.isRoot = true;
        const logToFile = config.logToFile ?? true;
        const logLevel = config.logLevel || process.env.LOG_LEVEL || 'info';
        const maxFiles = config.maxFiles ?? '14d';
        const maxSize = config.maxSize ?? '20m';
        const consoleOutput = config.consoleOutput ?? true;

        if (logToFile && !fs.existsSync(this.logDir)) {
            fs.mkdirSync(this.logDir, { recursive: true });
        }

        const parseMaxSize = (m: string | number): number => {
            if (typeof m === 'number') return m;
            const s = String(m).trim();
            if (s.endsWith('m')) return (parseInt(s, 10) || 20) * 1024 * 1024;
            return (parseInt(s, 10) || 20) * 1024 * 1024;
        };

        const consoleFormat = winston.format.combine(
            winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
            winston.format.colorize({ all: true }),
            winston.format.printf((info) => {
                const level = info.level;
                const message = String(info.message ?? '');
                const timestamp = info.timestamp;
                const tag = info.tag as string | undefined;
                const service = (info.service as string) || this.serviceName;
                const tagStr = tag ? ` \x1b[36m[${tag}]\x1b[0m` : '';
                const skip = new Set(['level', 'message', 'timestamp', 'tag', 'service', 'splat', 'audit']);
                const meta: Record<string, unknown> = {};
                for (const k of Object.keys(info)) {
                    if (!skip.has(k)) meta[k] = (info as any)[k];
                }
                const metaStr = Object.keys(meta).length ? `\n${JSON.stringify(meta, null, 2)}` : '';
                const serviceDisplay = `\x1b[1m${service}\x1b[0m`;
                return `[ ${serviceDisplay} ]${tagStr} ${timestamp} ${level}: ${message}${metaStr}`;
            }),
        );

        const fileFormat = winston.format.combine(
            winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
            winston.format.errors({ stack: true }),
            winston.format.json(),
        );

        const transports: winston.transport[] = [];

        if (consoleOutput) {
            transports.push(
                new winston.transports.Console({
                    format: consoleFormat,
                    level: logLevel,
                }),
            );
        }

        if (logToFile) {
            const maxsize = parseMaxSize(maxSize);
            const mf = typeof maxFiles === 'string' ? parseInt(maxFiles, 10) || 14 : maxFiles;

            transports.push(
                new winston.transports.File({
                    filename: path.join(this.logDir, 'combined.log'),
                    format: fileFormat,
                    level: logLevel,
                    maxsize,
                    maxFiles: mf,
                }),
            );

            transports.push(
                new winston.transports.File({
                    filename: path.join(this.logDir, 'error.log'),
                    format: fileFormat,
                    level: 'warn',
                    maxsize,
                    maxFiles: mf,
                }),
            );
        }

        this.logger = winston.createLogger({
            level: logLevel,
            defaultMeta: { service: this.serviceName },
            format: fileFormat,
            transports,
            exceptionHandlers: logToFile
                ? [
                      new winston.transports.File({
                          filename: path.join(this.logDir, 'exceptions.log'),
                          format: fileFormat,
                      }),
                  ]
                : [],
            rejectionHandlers: logToFile
                ? [
                      new winston.transports.File({
                          filename: path.join(this.logDir, 'rejections.log'),
                          format: fileFormat,
                      }),
                  ]
                : [],
        });
    }

    /** Дочерний логгер с полем `tag` во всех записях (тот же combined.log). */
    withTag(tag: string): MegaLogger {
        return new MegaLogger({
            _parentWinston: this.logger.child({ tag }),
            serviceName: this.serviceName,
            logDir: this.logDir,
        });
    }

    /**
     * @deprecated Используйте `withTag` — создавал отдельные транспорты и дублировал файлы.
     */
    child(serviceName: string): MegaLogger {
        return this.withTag(serviceName);
    }

    /** Бизнес-событие: одна строка JSON в `events.log` + info в основной поток. */
    audit(event: string, meta: Record<string, unknown> = {}): void {
        const payload = {
            ts: new Date().toISOString(),
            event,
            service: this.serviceName,
            ...meta,
        };
        try {
            fs.appendFileSync(path.join(this.logDir, 'events.log'), `${JSON.stringify(payload)}\n`, 'utf8');
        } catch {
            /* ignore disk errors */
        }
        this.logger.info(`[audit] ${event}`, { audit: true, event, ...meta });
    }

    fatal(message: string, meta?: Record<string, unknown>) {
        this.logger.log('error', `FATAL: ${message}`, meta);
    }

    error(message: string, meta?: Record<string, unknown>) {
        this.logger.error(message, meta);
    }

    warn(message: string, meta?: Record<string, unknown>) {
        this.logger.warn(message, meta);
    }

    info(message: string, meta?: Record<string, unknown>) {
        this.logger.info(message, meta);
    }

    http(message: string, meta?: Record<string, unknown>) {
        this.logger.http(message, meta);
    }

    debug(message: string, meta?: Record<string, unknown>) {
        this.logger.debug(message, meta);
    }

    verbose(message: string, meta?: Record<string, unknown>) {
        this.logger.verbose(message, meta);
    }

    success(message: string, meta?: Record<string, unknown>) {
        this.logger.info(message, { ...meta, outcome: 'success' });
    }

    start(message: string, meta?: Record<string, unknown>) {
        this.logger.info(message, { ...meta, phase: 'start' });
    }

    stop(message: string, meta?: Record<string, unknown>) {
        this.logger.warn(message, { ...meta, phase: 'stop' });
    }

    time<T>(label: string, fn: () => T): T {
        const start = Date.now();
        try {
            const result = fn();
            this.debug(`${label}`, { durationMs: Date.now() - start });
            return result;
        } catch (error) {
            this.error(`${label} failed`, { durationMs: Date.now() - start, error });
            throw error;
        }
    }

    async timeAsync<T>(label: string, fn: () => Promise<T>): Promise<T> {
        const start = Date.now();
        try {
            const result = await fn();
            this.debug(`${label}`, { durationMs: Date.now() - start });
            return result;
        } catch (error) {
            this.error(`${label} failed`, { durationMs: Date.now() - start, error });
            throw error;
        }
    }

    getWinstonLogger(): winston.Logger {
        return this.logger;
    }

    setLevel(level: string) {
        this.logger.level = level;
    }

    cleanup(daysOld: number = 7) {
        if (!fs.existsSync(this.logDir) || !this.isRoot) return;

        const files = fs.readdirSync(this.logDir);
        const now = Date.now();

        for (const file of files) {
            const filePath = path.join(this.logDir, file);
            try {
                const stats = fs.statSync(filePath);
                const ageDays = (now - stats.mtimeMs) / (1000 * 60 * 60 * 24);
                if (ageDays > daysOld) {
                    fs.unlinkSync(filePath);
                    this.info(`Cleaned up old log file: ${file}`);
                }
            } catch {
                /* ignore */
            }
        }
    }
}

const defaultLogger = new MegaLogger({
    serviceName: process.env.LOG_SERVICE_NAME || 'TaxiBot',
    logToFile: process.env.LOG_TO_FILE === '1',
    logLevel: process.env.LOG_LEVEL || 'debug',
    consoleOutput: process.env.LOG_CONSOLE !== '0',
});

export { MegaLogger, defaultLogger as logger };
export default defaultLogger;
