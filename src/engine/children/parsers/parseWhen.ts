import { DateTime } from 'luxon';

/**
 * Парсит время: "сейчас"/"2" -> null, "завтра 14:30" или "14:30" -> Date (момент в UTC).
 * @param text - входная строка с временем
 * @param timeZone - IANA-пояс места заказа ("Europe/Madrid"); введённое время считается местным для него
 * @param tomorrowMarker - маркер "завтра" (по умолчанию 'завтра')
 * @returns Date, null (если "сейчас"), undefined (если не распознано)
 */
export function parseWhen(
    text: string,
    timeZone: string,
    tomorrowMarker: string = 'завтра'
): Date | null | undefined {
    const t = text.trim().toLowerCase().normalize('NFC');
    if (t === 'сейчас' || t === '2' || t === 'now') return null;

    const match = t.match(new RegExp(`^(${tomorrowMarker}\\s+)?(\\d{1,2}):(\\d{2})$`));
    if (!match) return undefined;

    const isTomorrow = Boolean(match[1]);
    const hours = parseInt(match[2], 10);
    const minutes = parseInt(match[3], 10);

    if (hours > 23 || minutes > 59) return undefined;

    // Сегодня/завтра — по календарю места заказа, а не сервера
    const userNow = DateTime.now().setZone(timeZone);
    if (!userNow.isValid) return undefined;
    const day = isTomorrow ? userNow.plus({ days: 1 }) : userNow;

    return DateTime.fromObject(
        { year: day.year, month: day.month, day: day.day, hour: hours, minute: minutes },
        { zone: timeZone },
    ).toJSDate();
}
