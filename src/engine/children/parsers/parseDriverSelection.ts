/**
 * Парсер выбора водителей для main.driverList.
 */
export async function parseDriverSelection(
    input: string,
    driversMap: Record<string, string>,
    getLang: (key: string, lang?: string) => Promise<string>
): Promise<{ selected: string[] } | { error: string }> {
    const trimmed = input.trim();
    const allNumbers = Object.keys(driversMap);

    if (trimmed === '01') {
        return { selected: Object.values(driversMap) };
    }
    if (trimmed.startsWith('-')) {
        const numbers = trimmed.slice(1).split(/\s+/).filter(Boolean);
        if (numbers.length === 0) {
            const msg = await getLang('wab_noDriverNumbersForExclusion', '1');
            return { error: msg };
        }
        for (const n of numbers) {
            if (!driversMap[n]) {
                const msg = await getLang('wab_incorrectDriverNumber', '1');
                return { error: msg.replace('%number%', n) };
            }
        }
        const selected = allNumbers.filter((n) => !numbers.includes(n)).map((n) => driversMap[n]);
        return { selected };
    }
    const numbers = trimmed.split(/\s+/).filter(Boolean);
    if (numbers.length === 0) {
        const msg = await getLang('wab_noDriverNumbersSpecified', '1');
        return { error: msg };
    }
    for (const n of numbers) {
        if (!driversMap[n]) {
            const msg = await getLang('wab_incorrectDriverNumber', '1');
            return { error: msg.replace('%number%', n) };
        }
    }
    return { selected: numbers.map((n) => driversMap[n]) };
}
