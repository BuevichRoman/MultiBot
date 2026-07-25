/**
 * Парсит время: "сейчас"/"2" -> null, "завтра 14:30" или "14:30" -> Date в UTC.
 * @param text - входная строка с временем
 * @param timezoneOffset - смещение временной зоны в минутах (например, +60 для UTC+1, -240 для UTC-4)
 * @param tomorrowMarker - маркер "завтра" (по умолчанию 'завтра')
 * @returns Date в UTC, null (если "сейчас"), undefined (если не распознано)
 */
export function parseWhen(
    text: string,
    timezoneOffset: number,
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

    // Получаем текущее UTC время
    const nowUTC = new Date();

    // Вычисляем текущее "локальное" время пользователя
    // (UTC время + смещение пользователя)
    const userNowTimestamp = nowUTC.getTime() + (timezoneOffset * 60 * 1000);
    const userNow = new Date(userNowTimestamp);

    // Берем год, месяц, день из локального времени пользователя
    let year = userNow.getUTCFullYear();
    let month = userNow.getUTCMonth();
    let day = userNow.getUTCDate();

    if (isTomorrow) {
        // Увеличиваем день в локальном времени пользователя
        const nextDay = new Date(userNowTimestamp);
        nextDay.setUTCDate(nextDay.getUTCDate() + 1);
        year = nextDay.getUTCFullYear();
        month = nextDay.getUTCMonth();
        day = nextDay.getUTCDate();
    }

    // Создаем UTC дату: заданное пользователем время (hours:minutes)
    // нужно интерпретировать как локальное для его временной зоны,
    // значит в UTC это будет hours - (timezoneOffset / 60)
    const utcHours = hours - (timezoneOffset / 60);
    const utcMinutes = minutes;

    // Создаем Date в UTC
    const result = new Date(Date.UTC(year, month, day, utcHours, utcMinutes, 0, 0));

    return result;
}