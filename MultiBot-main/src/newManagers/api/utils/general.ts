/**
 * HTTP/Form utilities for API requests (auth, FormData, headers).
 * Migrated from old api/general.ts into new architecture.
 */

export interface AuthData {
    token: string;
    hash: string;
}

export const postHeaders = {
    'User-Agent': 'WhatsAppBot/1.0',
    'Content-Type': 'application/x-www-form-urlencoded',
    'Accept': 'application/json',
};

export function createForm(
    data: {
        [key: string]:
            | number
            | string
            | string[]
            | Blob
            | undefined
            | { [key: string]: string };
    },
    auth: AuthData,
): FormData {
    const form = new FormData();
    form.append('token', auth.token);
    form.append('u_hash', auth.hash);

    for (const key in data) {
        if (data[key] !== undefined) {
            const val = data[key];
            if (typeof val === 'string' || typeof val === 'number') {
                form.append(key, String(val));
            } else if (val instanceof Blob) {
                form.append(key, val);
            } else if (Array.isArray(val)) {
                form.append(key, val.join(','));
            } else if (typeof val === 'object' && val !== null) {
                form.append(key, JSON.stringify(val));
            }
        }
    }
    return form;
}
