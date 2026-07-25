import { getLegalDocsVersionsMap } from './legalDocUtils';
import { TelegramBotPollingAdaptor, WhatsappWebPollingAdaptor } from '../../../transport';
import TestAdapter from '../../../transport/TestAdapter/TestAdapter';

/**
 * Проверка, нужна ли пользователю акцептация новых версий документов (children tenant).
 */
export async function checkDocsNeedUpdate(
    api: any,
    orchestrator: any,
    userIdStr: string,
    botId?: string
): Promise<boolean> {
    if (!api?.getProfile) return false;

    const adapter = orchestrator?.getAdapter(botId || '');
    const idField =
        adapter instanceof TelegramBotPollingAdaptor || adapter instanceof TestAdapter
            ? { u_a_tg: userIdStr }
            : adapter instanceof WhatsappWebPollingAdaptor
                ? { u_a_wa: userIdStr }
                : { chatId: userIdStr };

    let profile: any;
    try {
        profile = await api.getProfile(idField);
    } catch {
        return false;
    }
    if (profile?.status !== 'success' || !profile?.data?.user) return false;

    const userKeys = Object.keys(profile.data.user);
    const user = userKeys.length ? profile.data.user[userKeys[0]] : null;
    const uDetailsDocs = user?.u_details?.docs;

    const dm = api?.api_data_manager;
    if (!dm) return false;
    if (!dm.isLoaded) await dm.load();

    const raw = dm?.data?.data?.site_constants?.bot_legal_docs;
    const botLegalDocs =
        typeof raw?.value === 'string' ? JSON.parse(raw.value || '{}') : (raw?.value ?? raw ?? {});
    if (!botLegalDocs?.public_offer || !botLegalDocs?.privacy_policy) return false;

    const currentVersions = getLegalDocsVersionsMap(botLegalDocs);
    const b1 = {
        privacy_policy: uDetailsDocs?.privacy_policy?.version,
        public_offer: uDetailsDocs?.public_offer?.version,
        legal_information: uDetailsDocs?.legal_information?.version,
    };
    const b2 = {
        privacy_policy: currentVersions?.privacy_policy,
        public_offer: currentVersions?.public_offer,
        legal_information: currentVersions?.legal_information,
    };

    return (
        b1.privacy_policy !== b2.privacy_policy ||
        b1.public_offer !== b2.public_offer ||
        b1.legal_information !== b2.legal_information
    );
}
