/**
 * Отправка ошибок во внешний мониторинг (Sentry).
 *
 * Включается только переменной `SENTRY_DSN`: без неё модуль ничего не
 * инициализирует и все вызовы — пустые. Так стенд и тесты не шлют событий,
 * а поведение без настройки остаётся прежним.
 *
 * Логи при этом никуда не деваются: мониторинг их дополняет, а не заменяет.
 * Сюда попадает то, что раньше гасилось в `catch` и было видно только в
 * файле на хосте.
 */
import * as Sentry from '@sentry/node';
import { getTaggedLogger } from '../logger';

const monitoringLog = getTaggedLogger('Monitoring');

/** Откуда пришла ошибка — попадает в теги события */
export interface ErrorContext {
    tenantId?: string;
    orderId?: string;
    chatId?: string | number;
    userId?: string | number;
    /** Место в коде: 'order-poll', 'break-state', 'cancel-order' */
    scope?: string;
}

let enabled = false;

/**
 * Коды сетевых сбоев, которые считаем шумом: связь с API рвётся регулярно,
 * опрос всё равно повторится на следующем тике. В логах они остаются
 */
const NETWORK_NOISE = new Set([
    'ECONNABORTED',
    'ETIMEDOUT',
    'ECONNRESET',
    'ERR_CANCELED',
    'ERR_NETWORK',
]);

const isNetworkNoise = (error: unknown): boolean => {
    const code = (error as { code?: unknown } | null)?.code;
    return typeof code === 'string' && NETWORK_NOISE.has(code);
};

/** Поднять мониторинг, если задан SENTRY_DSN. Вызывается один раз при старте */
export function initMonitoring(): void {
    const dsn = process.env.SENTRY_DSN;
    if (!dsn) return;

    Sentry.init({
        dsn,
        environment: process.env.SENTRY_ENV || process.env.NODE_ENV || 'development',
        release: process.env.SENTRY_RELEASE,
        tracesSampleRate: 0,
        integrations: [
            // Без этого SDK перехватывает необработанное исключение и
            // оставляет процесс жить: бот продолжал бы работать в неизвестном
            // состоянии вместо того, чтобы упасть и перезапуститься
            Sentry.onUncaughtExceptionIntegration({
                exitEvenIfOtherHandlersAreRegistered: true,
            }),
        ],
    });

    enabled = true;
    monitoringLog.info('monitoring enabled', {
        environment: process.env.SENTRY_ENV || process.env.NODE_ENV,
    });
}

export function isMonitoringEnabled(): boolean {
    return enabled;
}

/**
 * Отправить ошибку в мониторинг. Без настроенного DSN — ничего не делает,
 * вызывающий код в любом случае пишет своё сообщение в лог
 */
export function captureError(error: unknown, context: ErrorContext = {}): void {
    if (!enabled || isNetworkNoise(error)) return;

    Sentry.withScope((scope) => {
        if (context.tenantId) scope.setTag('tenant', context.tenantId);
        if (context.orderId) scope.setTag('orderId', String(context.orderId));
        if (context.scope) scope.setTag('scope', context.scope);
        if (context.chatId != null) scope.setExtra('chatId', String(context.chatId));
        if (context.userId != null) scope.setExtra('userId', String(context.userId));
        Sentry.captureException(error);
    });
}

/** Дождаться отправки накопленных событий (перед выходом процесса и в тестах) */
export async function flushMonitoring(timeoutMs = 2000): Promise<void> {
    if (!enabled) return;
    await Sentry.flush(timeoutMs);
}
