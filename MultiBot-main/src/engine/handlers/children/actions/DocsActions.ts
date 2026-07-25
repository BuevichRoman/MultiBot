import { pickMaxVersion } from '../../../children/docs/legalDocUtils';
import { BotLegalDoc, getValueByPath } from '../types';
import type { ActionContext } from './types';

function getBotLegalDocs(apiManager: any): any {
    const dm = apiManager?.api_data_manager;
    if (!dm?.data?.data?.site_constants?.bot_legal_docs) return null;
    const raw = dm.data.data.site_constants.bot_legal_docs;
    if (typeof raw === 'string') return JSON.parse(raw || '{}');
    if (typeof raw?.value === 'string') return JSON.parse(raw.value || '{}');
    return (raw?.value ?? raw ?? {});
}

function getUtcTimestamp(): string {
    return new Date().toUTCString();
}

export type ChildrenDocKey = 'public_offer' | 'privacy_policy' | 'legal_information';

/** Снимок документов в state: дублируем в data.children_docs и data.docs */
export function pickChildrenDocsFromRoot(root: any): any {
    if (!root || typeof root !== 'object') return undefined;
    return (
        root.data?.children_docs ??
        root.data?.docs ??
        root.data?.childrenDocs ??
        root.registration?.children_docs ??
        root.registration?.childrenDocs ??
        root.children_docs ??
        root.childrenDocs
    );
}

export async function persistChildrenDocs(
    ctx: ActionContext,
    children_docs: Record<string, { version: string; accepted: string }>,
): Promise<void> {
    const copy = JSON.parse(JSON.stringify(children_docs)) as Record<string, { version: string; accepted: string }>;
    await ctx.mergeData({ data: { children_docs: copy, docs: copy } });
}

/**
 * Собрать снимок версий документов из API (как в initDocsFlow), без отправки сообщений.
 */
const EMPTY_DOC = { version: '0', accepted: '' };

export function buildChildrenDocsSnapshotFromApi(apiManager: any): Record<
    string,
    { version: string; accepted: string }
> {
    const botLegalDocs = getBotLegalDocs(apiManager);
    if (!botLegalDocs) {
        return {
            public_offer: { ...EMPTY_DOC },
            privacy_policy: { ...EMPTY_DOC },
            legal_information: { ...EMPTY_DOC },
        };
    }
    const publicOfferDoc = botLegalDocs.public_offer;
    const privacyPolicyDoc = botLegalDocs.privacy_policy;
    const legalInfoDoc = botLegalDocs.legal_information;
    const publicOfferMax = publicOfferDoc?.content?.length ? pickMaxVersion(publicOfferDoc.content as any) : null;
    const privacyPolicyMax = privacyPolicyDoc?.content?.length ? pickMaxVersion(privacyPolicyDoc.content as any) : null;
    const legalInfoMax = legalInfoDoc?.content?.length ? pickMaxVersion(legalInfoDoc.content as any) : null;
    return {
        public_offer: publicOfferMax
            ? { version: String(publicOfferMax.version), accepted: '' }
            : { ...EMPTY_DOC },
        privacy_policy: privacyPolicyMax
            ? { version: String(privacyPolicyMax.version), accepted: '' }
            : { ...EMPTY_DOC },
        legal_information: legalInfoMax
            ? { version: String(legalInfoMax.version), accepted: '' }
            : { ...EMPTY_DOC },
    };
}

/** Для register/data: FSM (принятия по ходу сценария) + подстановка версий из API. */
export function combineDocsForRegisterPayload(
    fsmSlice: Record<string, { version: string; accepted: string }> | null,
    apiManager: any,
): Record<string, { version: string; accepted: string }> {
    const fromApi = buildChildrenDocsSnapshotFromApi(apiManager);
    const pick = (key: 'public_offer' | 'privacy_policy' | 'legal_information') => {
        const a = fsmSlice?.[key];
        const b = fromApi[key];
        if (a?.version && a.version !== '0') {
            return { version: a.version, accepted: a.accepted ?? '' };
        }
        if (b?.version && b.version !== '0') {
            return { version: b.version, accepted: a?.accepted ?? '' };
        }
        return { version: a?.version ?? b?.version ?? '0', accepted: a?.accepted ?? '' };
    };
    return {
        public_offer: pick('public_offer'),
        privacy_policy: pick('privacy_policy'),
        legal_information: pick('legal_information'),
    };
}

/**
 * Положить снимок документов в FSM (data.children_docs + data.docs).
 * Если в API ещё нет версий (всё "0"), всё равно создаём каркас — иначе markChildrenDocAccepted не к чему писать accepted.
 */
export async function ensureChildrenDocsInFsm(ctx: ActionContext): Promise<void> {
    await ctx.ensureApiDataLoaded();
    const root = await ctx.getData();
    const existing = pickChildrenDocsFromRoot(root);
    const snapshot = buildChildrenDocsSnapshotFromApi(ctx.apiManager);

    if (existing?.public_offer?.version && existing.public_offer.version !== '0') {
        return;
    }

    if (existing?.public_offer == null) {
        await persistChildrenDocs(ctx, snapshot);
        return;
    }

    if (snapshot.public_offer.version !== '0') {
        await persistChildrenDocs(ctx, {
            public_offer: {
                version: snapshot.public_offer.version,
                accepted: existing.public_offer?.accepted ?? '',
            },
            privacy_policy: {
                version: snapshot.privacy_policy.version,
                accepted: existing.privacy_policy?.accepted ?? '',
            },
            legal_information: {
                version: snapshot.legal_information.version,
                accepted: existing.legal_information?.accepted ?? '',
            },
        });
    }
}

const DOC_KEYS: ChildrenDocKey[] = ['public_offer', 'privacy_policy', 'legal_information'];

/** После ввода «1» на шаге документа: пишем accepted (UTC) для соответствующего ключа в data.docs / data.children_docs. */
export async function markChildrenDocAccepted(ctx: ActionContext, doc: ChildrenDocKey | undefined): Promise<void> {
    if (!doc || !DOC_KEYS.includes(doc)) return;
    await ensureChildrenDocsInFsm(ctx);
    let root = await ctx.getData();
    let raw = pickChildrenDocsFromRoot(root);
    if (raw?.public_offer == null) {
        await persistChildrenDocs(ctx, buildChildrenDocsSnapshotFromApi(ctx.apiManager));
        root = await ctx.getData();
        raw = pickChildrenDocsFromRoot(root);
    }
    if (raw?.public_offer == null) return;
    const children_docs = JSON.parse(JSON.stringify(raw)) as Record<string, { version: string; accepted: string }>;
    const ts = getUtcTimestamp();
    if (doc === 'public_offer' && children_docs.public_offer) {
        children_docs.public_offer.accepted = ts;
    } else if (doc === 'privacy_policy' && children_docs.privacy_policy) {
        children_docs.privacy_policy.accepted = ts;
    } else if (doc === 'legal_information' && children_docs.legal_information) {
        children_docs.legal_information.accepted = ts;
    }
    await persistChildrenDocs(ctx, children_docs);
}

export async function handleInitDocsFlow(ctx: ActionContext): Promise<void> {
    await ctx.ensureApiDataLoaded();
    const needMsg = await ctx.getLocalizedText('wab_needToAcceptNewDocs', '1');
    await ctx.sendMessage(needMsg);

    const key = 'site_constants.bot_legal_docs.value.public_offer';
    const publicOfferDoc = getValueByPath(ctx.apiManager?.api_data_manager?.data?.data, key) as BotLegalDoc | undefined;
    if (publicOfferDoc?.content) {
        const publicOfferMax = pickMaxVersion(publicOfferDoc.content as any);
        const lang = '1';
        for (const part of (publicOfferMax?.parts || [])) {
            const t = (part as any)[lang] ?? (part as any)['1'];
            if (t) {
                await ctx.sendMessage(t);
                await new Promise(r => setTimeout(r, 300));
            }
        }
    }

    const botLegalDocs = getBotLegalDocs(ctx.apiManager);
    const publicOfferDocFromBot = botLegalDocs?.public_offer;
    const privacyPolicyDoc = botLegalDocs?.privacy_policy;
    const legalInfoDoc = botLegalDocs?.legal_information;
    const publicOfferMax = publicOfferDocFromBot?.content?.length ? pickMaxVersion(publicOfferDocFromBot.content as any) : null;
    const privacyPolicyMax = privacyPolicyDoc?.content?.length ? pickMaxVersion(privacyPolicyDoc.content as any) : null;
    const legalInfoMax = legalInfoDoc?.content?.length ? pickMaxVersion(legalInfoDoc.content as any) : null;

    const children_docs: Record<string, { version: string; accepted: string }> = {
        public_offer: publicOfferMax ? { version: String(publicOfferMax.version), accepted: '' } : { version: '0', accepted: '' },
        privacy_policy: privacyPolicyMax ? { version: String(privacyPolicyMax.version), accepted: '' } : { version: '0', accepted: '' },
        legal_information: legalInfoMax ? { version: String(legalInfoMax.version), accepted: '' } : { version: '0', accepted: '' },
    };
    await persistChildrenDocs(ctx, children_docs);
}

export async function handleSendDocsPrivacyPolicy(ctx: ActionContext): Promise<void> {
    const data = await ctx.getData();
    const raw = pickChildrenDocsFromRoot(data);
    if (raw?.public_offer) {
        const children_docs = JSON.parse(JSON.stringify(raw)) as Record<string, { version: string; accepted: string }>;
        children_docs.public_offer.accepted = getUtcTimestamp();
        await persistChildrenDocs(ctx, children_docs);
    }
    const botLegalDocs = getBotLegalDocs(ctx.apiManager);
    if (!botLegalDocs?.privacy_policy?.content) return;
    const privacyMax = pickMaxVersion(botLegalDocs.privacy_policy.content as any);
    for (const part of privacyMax.parts || []) {
        const text = (part as any)['1'];
        if (text) {
            await ctx.sendMessage(text);
            await new Promise(r => setTimeout(r, 300));
        }
    }
}

export async function handleSendDocsLegalInfo(ctx: ActionContext): Promise<void> {
    const data = await ctx.getData();
    const raw = pickChildrenDocsFromRoot(data);
    if (raw?.privacy_policy) {
        const children_docs = JSON.parse(JSON.stringify(raw)) as Record<string, { version: string; accepted: string }>;
        children_docs.privacy_policy.accepted = getUtcTimestamp();
        await persistChildrenDocs(ctx, children_docs);
    }
    const botLegalDocs = getBotLegalDocs(ctx.apiManager);
    if (!botLegalDocs?.legal_information?.content) return;
    const legalMax = pickMaxVersion(botLegalDocs.legal_information.content as any);
    const continueText = await ctx.getLocalizedText('wab_childrenDocsActionContinueOrder', '1');
    for (const part of legalMax.parts || []) {
        let text = (part as any)['1'];
        if (text) {
            text = text.replace(/%action%/g, continueText);
            await ctx.sendMessage(text);
            await new Promise(r => setTimeout(r, 300));
        }
    }
}

export async function handleSaveDocsToApi(ctx: ActionContext): Promise<void> {
    const data = await ctx.getData();
    const children_docs = pickChildrenDocsFromRoot(data);
    if (children_docs?.public_offer == null) return;
    if (children_docs.legal_information) {
        children_docs.legal_information.accepted = getUtcTimestamp();
    }
    const u_details = [
        ['=', ['docs', 'public_offer', 'version'], children_docs.public_offer.version],
        ['=', ['docs', 'privacy_policy', 'version'], children_docs.privacy_policy?.version ?? '0'],
        ['=', ['docs', 'legal_information', 'version'], children_docs.legal_information?.version ?? '0'],
        ['=', ['docs', 'public_offer', 'accepted'], children_docs.public_offer.accepted || getUtcTimestamp()],
        ['=', ['docs', 'privacy_policy', 'accepted'], children_docs.privacy_policy?.accepted || ''],
        ['=', ['docs', 'legal_information', 'accepted'], children_docs.legal_information?.accepted || ''],
    ];
    if (ctx.apiManager?.editUserDetails) {
        await ctx.apiManager.editUserDetails(ctx.getIdField(), u_details);
    }
}
