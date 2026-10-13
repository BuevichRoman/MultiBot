/**
 * Номер заказа в тексте для поддержки: %order% в шаблоне, а если его там нет —
 * отдельной строкой в конце. Шаблоны живут в lang_vls платформы.
 */
export function withOrderNumber(text: string, orderId: unknown, langId: string): string {
    const id = orderId == null ? '' : String(orderId).trim();
    if (!id) return text;
    if (/%order%/.test(text)) return text.replace(/%order%/g, id);
    return `${text}\n\n${langId === '1' ? `Заказ № ${id}` : `Order # ${id}`}`;
}
