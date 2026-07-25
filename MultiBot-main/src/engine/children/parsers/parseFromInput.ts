/**
 * Парсинг ввода точки (latitude, longitude) для main.from.
 * Ожидается формат: "lat, lng" или "lat lng" или "lat; lng"
 */
export function parseFromInput(text: string): { latitude: string; longitude: string } | null {
    const match = text.match(/^(-?\d+(?:\.\d+)?)\s*[,;\s]\s*(-?\d+(?:\.\d+)?)$/);
    if (!match) return null;
    const [, latitude, longitude] = match;
    return { latitude: latitude!.trim(), longitude: longitude!.trim() };
}
