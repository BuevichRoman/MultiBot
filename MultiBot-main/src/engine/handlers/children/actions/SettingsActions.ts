import {
    CHILDREN_LANGUAGES,
    LANG_MENU_TO_API_ID,
    API_LANG_ID_TO_ISO,
} from '../../../children/settings/settingsHelpers';
import { pickMaxVersion } from '../../../children/docs/legalDocUtils';
import type { ActionContext } from './types';
import { logBusinessEvent } from '../../../../addons/logger';

export async function handleSendSettingsMenu(ctx: ActionContext): Promise<void> {
    await ctx.ensureApiDataLoaded();
    let user: any = null;
    try {
        const res = await ctx.apiManager.getProfile(ctx.getIdField());
        if (res?.status === 'success' && res?.data?.user) {
            const keys = Object.keys(res.data.user);
            user = keys.length ? res.data.user[keys[0]] : null;
        }
    } catch {
        /* ignore */
    }
    const overrides = ctx.orchestrator.getTenantOverrides?.(ctx.tenantId);
    const testRefCode = overrides?.testRefCode ?? '666';
    const isTestMode = user?.referrer_u_id === testRefCode;
    const langId = user?.settings?.lang?.api_id?.toString() || '1';

    let menu = await ctx.getLocalizedText('wab_settingsmenu', langId);
    menu = menu.replace(/%language%/g, `${user?.settings?.lang?.native || 'English'} (${user?.settings?.lang?.iso || 'en'})`);
    menu = menu.replace(/%refCode%/g, user?.referrer_u_id ?? '---');
    menu = menu.replace(/%selfRefCode%/g, user?.ref_code ?? '---');
    const prevHint = isTestMode && user?.u_details?.refCodeBackup
        ? ((await ctx.getLocalizedText('wab_settingspreviousreferralcode', langId)) || '').replace('%code%', user.u_details.refCodeBackup) + '\n'
        : '';
    menu = menu.replace(/%prevRefCodeHint%/g, prevHint);
    const testHint = await ctx.getLocalizedText(isTestMode ? 'wab_settingstestmodeactive' : 'wab_settingstestmodehint', langId);
    menu = menu.replace(/%testModeHint%/g, testHint);
    await ctx.sendMessage(menu);
}

export async function handleSendLanguageList(ctx: ActionContext): Promise<void> {
    const selectMsg = await ctx.getLocalizedText('wab_selectlanguage', '1');
    await ctx.sendMessage(selectMsg);
    await ctx.sendMessage(CHILDREN_LANGUAGES);
}

function getBotLegalDocs(apiManager: any): any {
    const dm = apiManager?.api_data_manager;
    if (!dm?.data?.data?.site_constants?.bot_legal_docs) return null;
    const raw = dm.data.data.site_constants.bot_legal_docs;
    if (typeof raw === 'string') return JSON.parse(raw || '{}');
    if (typeof raw?.value === 'string') return JSON.parse(raw.value || '{}');
    return (raw?.value ?? raw ?? {});
}

export async function handleSendLegalInfo(ctx: ActionContext): Promise<void> {
    const botLegalDocs = getBotLegalDocs(ctx.apiManager);
    if (!botLegalDocs?.legal_information?.content) return;
    const legalMax = pickMaxVersion(botLegalDocs.legal_information.content as any);
    //const continueText = await ctx.getLocalizedText('wab_childrenDocsActionContinueOrder', '1');
    const lang = '1';
    for (const part of legalMax.parts || []) {
        let text = (part as any)[lang] ?? (part as any)['1'];
        if (text) {
            //text = text.replace(/%action%/g, continueText);
            await ctx.sendMessage(text);
            await new Promise(r => setTimeout(r, 300));
        }
    }
}

export async function handleToggleTestMode(ctx: ActionContext): Promise<void> {
    let user: any = null;
    try {
        const res = await ctx.apiManager.getProfile(ctx.getIdField());
        if (res?.status === 'success' && res?.data?.user) {
            const keys = Object.keys(res.data.user);
            user = keys.length ? res.data.user[keys[0]] : null;
        }
    } catch {
        return;
    }
    const overrides = ctx.orchestrator.getTenantOverrides?.(ctx.tenantId);
    const testRefCode = overrides?.testRefCode ?? '666';
    const isTestMode = user?.referrer_u_id === testRefCode;
    const uId = user?.u_id ?? user?.api_u_id;
    if (!uId) return;

    if (isTestMode) {
        const prevCode = user?.u_details?.refCodeBackup || '';
        await ctx.apiManager.changeUserReferralCode?.(uId, prevCode, testRefCode);
    } else {
        if (!user?.u_details) user.u_details = {};
        user.u_details.refCodeBackup = user.referrer_u_id;
        await ctx.apiManager.changeUserReferralCode?.(uId, testRefCode, user.referrer_u_id || '');
    }
}

export async function handleSaveLanguageChange(ctx: ActionContext): Promise<void> {
    const container = await ctx.getData();
    const selected = container?.data?.selectedLangId ?? container?.['data.selectedLangId'];
    if (!selected) return;
    const apiLangId = LANG_MENU_TO_API_ID[String(selected)] ?? selected;
    const res = await ctx.apiManager.changeUserLang?.(ctx.getIdField(), apiLangId);
    if (res?.status === 'success') {
        const iso = API_LANG_ID_TO_ISO[apiLangId] || 'en';
        const msg = await ctx.getLocalizedText('wab_langselectedbakingtosettings', apiLangId);
        await ctx.sendMessage((msg || '').replace(/%lang%/g, iso.toUpperCase()));
    }
}

export async function handleDeleteAccount(ctx: ActionContext): Promise<void> {
    const container = await ctx.getData();
    const fullName = container?.data?.fullName ?? '';
    const res = await ctx.apiManager.editUserProfile?.(ctx.getIdField(), {
        u_name: fullName,
        u_details: [
            ['-', ['birthYear']],
            ['-', ['phone']],
            ['-', ['cityString']],
            ['=', ['deleted'], '1'],
        ],
    });
    if (res?.status === 'success') {
        const msg = await ctx.getLocalizedText('wab_accountdeleted', '1');
        await ctx.sendMessage(msg);
        await ctx.fsm.clearUserStateAndData(ctx.tenantId, ctx.userId, ctx.botId);
        logBusinessEvent('user.account_deleted', {
            tenantId: ctx.tenantId,
            userId: String(ctx.userId),
            chatId: String(ctx.chatId),
            botId: ctx.botId,
            ...ctx.getIdField(),
        });
    } else {
        await ctx.sendMessage('Error: ' + (res?.message || 'unknown'));
    }
}

export async function handleSaveFullNameAndBirthYear(ctx: ActionContext): Promise<void> {
    const container = await ctx.getData();
    const fullName = container?.data?.fullName;
    const birthYear = container?.data?.birthYear;
    if (!fullName || !birthYear) return;
    const res = await ctx.apiManager.editUserProfile?.(ctx.getIdField(), {
        u_name: fullName,
        u_details: [['=', ['birthYear'], birthYear]],
    });
    if (res?.status !== 'success') {
        await ctx.sendMessage('Error: ' + (res?.message || 'unknown'));
        const defaultMsg = await ctx.getLocalizedText('wab_defaultPrompt', '1');
        await ctx.sendMessage(defaultMsg);
    }
}

export async function handleSavePhone(ctx: ActionContext): Promise<void> {
    const container = await ctx.getData();
    const phone = container?.data?.phone ?? container?.['data.phone'];
    if (!phone) return;
    const res = await ctx.apiManager.editUserProfile?.(ctx.getIdField(), {
        u_details: [['=', ['phone'], phone]],
    });
    if (res?.status !== 'success') {
        await ctx.sendMessage('Error: ' + (res?.message || 'unknown'));
        const defaultMsg = await ctx.getLocalizedText('wab_defaultPrompt', '1');
        await ctx.sendMessage(defaultMsg);
    }
}

export async function handleSaveCity(ctx: ActionContext): Promise<void> {
    const container = await ctx.getData();
    const city = container?.data?.cityString ?? container?.['data.cityString'];
    if (!city) return;
    const res = await ctx.apiManager.editUserProfile?.(ctx.getIdField(), {
        u_details: [['=', ['cityString'], city]],
    });
    if (res?.status !== 'success') {
        await ctx.sendMessage('Error: ' + (res?.message || 'unknown'));
        const defaultMsg = await ctx.getLocalizedText('wab_defaultPrompt', '1');
        await ctx.sendMessage(defaultMsg);
    }
}
