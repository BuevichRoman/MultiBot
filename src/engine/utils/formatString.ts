/** Подстановка `%key%` в строке по словарю. */
export function formatString(text: string, args: Record<string, string>): string {
    let result = text;
    Object.keys(args).forEach((key) => {
        result = result.replace(new RegExp(`%${key}%`, 'g'), args[key]);
    });
    return result;
}
