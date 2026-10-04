/** Паузы между попытками: 5 с, 15 с, 30 с, дальше раз в минуту. */
export const TELEGRAM_RETRY_DELAYS_MS = [5_000, 15_000, 30_000, 60_000];

const defaultSleep = (ms: number) =>
    new Promise<void>((resolve) => {
        // unref: пауза между попытками не держит процесс при остановке
        setTimeout(resolve, ms).unref?.();
    });

/**
 * Запускает run() заново после каждой ошибки, пока он не завершится штатно
 * или shouldStop() не вернёт true. Последняя пауза из delaysMs повторяется.
 *
 * Нужен для Telegram polling: init() падает на сетевом таймауте или 409 при
 * рестарте, и без повтора бот молчит до ручного перезапуска, хотя процесс жив.
 */
export async function runWithRetry(
    run: () => Promise<void>,
    opts: {
        delaysMs: number[];
        shouldStop: () => boolean;
        onError: (error: unknown, attempt: number, nextDelayMs: number) => void;
        sleep?: (ms: number) => Promise<void>;
    }
): Promise<void> {
    const sleep = opts.sleep ?? defaultSleep;
    for (let attempt = 1; !opts.shouldStop(); attempt++) {
        try {
            await run();
            return;
        } catch (e) {
            if (opts.shouldStop()) return;
            const delay = opts.delaysMs[Math.min(attempt - 1, opts.delaysMs.length - 1)];
            opts.onError(e, attempt, delay);
            await sleep(delay);
        }
    }
}
