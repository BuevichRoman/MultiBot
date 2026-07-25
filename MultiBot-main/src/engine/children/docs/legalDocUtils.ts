/**
 * Типы и утилиты для bot_legal_docs (версии, pickMaxVersion).
 */

export interface BotLegalDocs {
    [key: string]: {
        name: { [langCode: string]: string };
        content: Array<{
            version: number;
            created: string;
            parts: Array<{ [langCode: string]: string }>;
        }>;
    };
}

export function getLegalDocsVersionsMap(bot_legal_docs: BotLegalDocs): Record<string, string> {
    const legalDocsVersionsMap: Record<string, string> = {};
    Object.entries(bot_legal_docs).forEach(([key, value]) => {
        let maxVersion = 0;
        value.content.forEach((content) => {
            if (content.version > maxVersion) maxVersion = content.version;
        });
        legalDocsVersionsMap[key] = maxVersion.toString();
    });
    return legalDocsVersionsMap;
}

export function pickMaxVersion(
    content: Array<{
        version: number;
        created: string;
        parts: Array<{ [langCode: string]: string }>;
    }>,
): { version: number; created: string; parts: Array<{ [langCode: string]: string }> } {
    let maxVersion = 0;
    let maxVersionIndex = 0;
    content.forEach((item, index) => {
        if (item.version > maxVersion) {
            maxVersion = item.version;
            maxVersionIndex = index;
        }
    });
    return content[maxVersionIndex];
}
