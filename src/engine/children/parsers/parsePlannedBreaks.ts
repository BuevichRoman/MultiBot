/**
 * Разбор плановых перерывов, которые заказчик указывает при создании заказа
 * (ТЗ-001 п. 5).
 *
 * Формат ввода: `11:00-12:00`, несколько интервалов через запятую.
 * Время хранится как есть, парами `ЧЧ:ММ` — привязка к дате заказа
 * происходит позже, когда известно время начала (см. APIManager.createDrive).
 */

/** Интервал в виде пары `ЧЧ:ММ` */
export interface PlannedBreakInput {
    started: string;
    ended: string;
}

const INTERVAL = /^(\d{1,2}):(\d{2})\s*[-–—]\s*(\d{1,2}):(\d{2})$/;

const toMinutes = (hours: number, minutes: number) => hours * 60 + minutes;

const pad = (value: number) => String(value).padStart(2, '0');

/**
 * Разбирает строку с интервалами.
 *
 * @returns список интервалов, либо `undefined` если строку разобрать не
 * удалось. Пустой список означает, что перерывы не планируются
 */
export function parsePlannedBreaks(text: string): PlannedBreakInput[] | undefined {
    const trimmed = (text ?? '').trim();
    if (trimmed === '') return undefined;

    const parts = trimmed.split(',').map((part) => part.trim()).filter((part) => part !== '');
    if (parts.length === 0) return undefined;

    const result: PlannedBreakInput[] = [];

    for (const part of parts) {
        const match = INTERVAL.exec(part);
        if (!match) return undefined;

        const startHours = Number(match[1]);
        const startMinutes = Number(match[2]);
        const endHours = Number(match[3]);
        const endMinutes = Number(match[4]);

        if (startHours > 23 || endHours > 23 || startMinutes > 59 || endMinutes > 59) {
            return undefined;
        }

        // Интервал нулевой или обратный смысла не имеет. Перерыв через
        // полночь тоже отклоняем: в таком виде его не отличить от опечатки
        if (toMinutes(startHours, startMinutes) >= toMinutes(endHours, endMinutes)) {
            return undefined;
        }

        result.push({
            started: `${pad(startHours)}:${pad(startMinutes)}`,
            ended: `${pad(endHours)}:${pad(endMinutes)}`,
        });
    }

    // Пересекающиеся интервалы — почти наверняка ошибка ввода
    const sorted = [...result].sort((a, b) => a.started.localeCompare(b.started));
    for (let i = 1; i < sorted.length; i++) {
        const previous = sorted[i - 1]!;
        const current = sorted[i]!;
        if (current.started < previous.ended) return undefined;
    }

    return result;
}
