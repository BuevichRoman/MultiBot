import * as geoTz from 'geo-tz';

/** Пояс, в котором бот считал время до появления координат: фиксированный UTC+1. */
export const FALLBACK_TIME_ZONE = 'Etc/GMT-1';

/**
 * IANA-пояс места заказа ("Europe/Madrid") по координатам.
 * Летнее время и прочие переводы часов учитываются базой поясов Node/luxon,
 * поэтому смещение руками не задаём. Без координат — прежний UTC+1.
 */
export function orderTimeZone(lat: unknown, lng: unknown): string {
    const la = Number(lat);
    const ln = Number(lng);
    if (lat == null || lng == null || !Number.isFinite(la) || !Number.isFinite(ln)) return FALLBACK_TIME_ZONE;
    try {
        return geoTz.find(la, ln)[0] ?? FALLBACK_TIME_ZONE;
    } catch {
        return FALLBACK_TIME_ZONE;
    }
}
