import { Orchestrator } from '../../../newManagers/orchestrator/Orchestrator';
import { FSMManager } from '../../managers/FSMManager';
import { TenantSchema, Action } from '../../types';
import { BotLegalDoc, getValueByPath, setValueByPath } from './types';
import { getRegistrationSlice } from './fsmStorage';
import { TelegramBotPollingAdaptor, WhatsappWebPollingAdaptor } from '../../../transport';
import TestAdapter from '../../../transport/TestAdapter/TestAdapter';
import * as OrderActions from './actions/OrderActions';
import * as SettingsActions from './actions/SettingsActions';
import * as DocsActions from './actions/DocsActions';
import type { ActionContext } from './actions/types';
import { getTaggedLogger, logBusinessEvent } from '../../../addons/logger';

const actionLog = getTaggedLogger('ActionExecutor');

export class ActionExecutor {
    private orchestrator: Orchestrator;
    private fsm: FSMManager;
    private schema: TenantSchema;
    private botId: string;
    private chatId: string;
    private userId: string;
    private input: string;
    private tenantId: string;
    private currentState: string;
    private apiManager: any;
    private taskManager: any = null;

    constructor(
        orchestrator: Orchestrator,
        fsm: FSMManager,
        schema: TenantSchema,
        botId: string,
        chatId: string,
        userId: string,
        input: string,
        tenantId: string,
        currentState: string,
        apiManager?: any
    ) {
        this.orchestrator = orchestrator;
        this.fsm = fsm;
        this.schema = schema;
        this.botId = botId;
        this.chatId = chatId;
        this.userId = userId;
        this.input = input;
        this.tenantId = tenantId;
        this.currentState = currentState;
        this.apiManager = apiManager;
        this.taskManager = (orchestrator as any).engine?.getTaskManager?.();
    }

    private async ensureApiDataLoaded() {
        if (this.apiManager?.api_data_manager && !this.apiManager.api_data_manager.isLoaded) {
            try {
                await this.apiManager.api_data_manager.load();
            } catch (e) {
                actionLog.error('Failed to load API data', { error: e });
            }
        }
    }

    private async getLocalizedText(key: string, lang?: string): Promise<string> {
        if (!this.apiManager?.api_data_manager?.isLoaded) {
            await this.ensureApiDataLoaded();
        }
        try {
            if (this.apiManager?.api_data_manager?.isLoaded) {
                const targetLang = lang === 'default'
                    ? this.apiManager.api_data_manager.data.data.site_constants.gfp_taxi_bot_settings.value.defaultLangID.toString()
                    : lang || '1';
                return await this.apiManager.api_data_manager.getLangValueItem(
                    key.toLowerCase(),
                    targetLang
                );
            }
        } catch (e) {
            actionLog.error(`Error getting localized text for key ${key}`, { error: e });
        }
        return key;
    }

    private async sendMessage(text: string): Promise<void> {
        const adapter = this.orchestrator.getAdapter(this.botId) as any;
        if (adapter?.sendMessage) {
            await adapter.sendMessage(this.chatId, text);
        }
    }

    private getIdField(): Record<string, string> {
        const adapter = this.orchestrator.getAdapter(this.botId);
        if (adapter instanceof TelegramBotPollingAdaptor || adapter instanceof TestAdapter) {
            return { u_a_tg: String(this.userId) };
        }
        if (adapter instanceof WhatsappWebPollingAdaptor) {
            return { u_a_wa: String(this.userId) };
        }
        return { chatId: String(this.userId) };
    }

    private async sendMessageAndGetId(text: string): Promise<string | undefined> {
        const adapter = this.orchestrator.getAdapter(this.botId) as any;
        if (adapter?.sendMessage) {
            const res = await adapter.sendMessage(this.chatId, text);
            return (res as { messageId?: string })?.messageId;
        }
        return undefined;
    }

    private async getStateDef(state: string) {
        for (const flow of Object.values(this.schema.flows || {})) {
            if (flow.states?.[state]) {
                return flow.states[state];
            }
        }
        return undefined;
    }

    private createContext(): ActionContext {
        return {
            fsm: this.fsm,
            apiManager: this.apiManager,
            orchestrator: this.orchestrator,
            tenantId: this.tenantId,
            userId: this.userId,
            chatId: this.chatId,
            botId: this.botId,
            input: this.input,
            sendMessage: (t) => this.sendMessage(t),
            sendMessageAndGetId: (t) => this.sendMessageAndGetId(t),
            getLocalizedText: (k, l) => this.getLocalizedText(k, l),
            getIdField: () => this.getIdField(),
            ensureApiDataLoaded: () => this.ensureApiDataLoaded(),
            getData: () => this.fsm.getData(this.tenantId, this.userId, this.botId),
            mergeData: (p) => this.fsm.mergeData(this.tenantId, this.userId, p, this.botId),
            setData: (d) => this.fsm.setData(this.tenantId, this.userId, d, this.botId),
            taskManager: this.taskManager,
        };
    }

    async execute(actions: string[] | undefined) {
        if (!actions?.length) return;
        for (const actionName of actions) {
            let actionDef: Action | undefined = this.schema.actions?.[actionName];
            if (!actionDef) {
                const stateDef = await this.getStateDef(this.currentState);
                actionDef = stateDef?.actions?.[actionName];
            }
            if (!actionDef) {
                actionLog.warn(`Action not found: ${actionName}`);
                continue;
            }
            await this.executeAction(actionName, actionDef);
        }
    }

    private async executeAction(actionName: string, actionDef: Action) {
        const ctx = this.createContext();

        switch (actionDef.type) {
            case 'sendL10n':
                await this.handleSendL10n(actionDef);
                break;
            case 'sendBotLegalDocs':
                await this.handleSendBotLegalDocs(actionDef);
                break;
            case 'apiCall':
                if (actionDef.endpoint === '/register') await this.handleRegister();
                break;
            case 'data':
                await this.handleDataOperation(actionDef);
                break;
            case 'save':
                await this.handleSave(actionDef);
                break;
            case 'startDriverSearch':
                await OrderActions.handleStartDriverSearch(ctx);
                break;
            case 'createOrder':
                await OrderActions.handleCreateOrder(ctx);
                break;
            case 'sendDriverSelectionError':
                await OrderActions.handleSendDriverSelectionError(ctx);
                break;
            case 'setRate':
                await OrderActions.handleSetRate(ctx);
                break;
            case 'setReview':
                await OrderActions.handleSetReview(ctx);
                break;
            case 'initDocsFlow':
                await DocsActions.handleInitDocsFlow(ctx);
                break;
            case 'sendDocsPrivacyPolicy':
                await DocsActions.handleSendDocsPrivacyPolicy(ctx);
                break;
            case 'sendDocsLegalInfo':
                await DocsActions.handleSendDocsLegalInfo(ctx);
                break;
            case 'saveDocsToApi':
                await DocsActions.handleSaveDocsToApi(ctx);
                break;
            case 'ensureChildrenDocsInFsm':
                await DocsActions.ensureChildrenDocsInFsm(ctx);
                break;
            case 'markChildrenDocAccepted':
                await DocsActions.markChildrenDocAccepted(ctx, actionDef.params?.doc);
                break;
            case 'clearOrderData':
                await OrderActions.handleClearOrderData(ctx);
                break;
            case 'sendSelectAdditionalOptions':
                await OrderActions.handleSendSelectAdditionalOptions(ctx);
                break;
            case 'sendOrderConfirmation':
                await OrderActions.handleSendOrderConfirmation(ctx);
                break;
            case 'sendOrderCompleted':
                await OrderActions.handleSendOrderCompleted(ctx);
                break;
            case 'sendSettingsMenu':
                await SettingsActions.handleSendSettingsMenu(ctx);
                break;
            case 'sendLanguageList':
                await SettingsActions.handleSendLanguageList(ctx);
                break;
            case 'sendLegalInfo':
                await SettingsActions.handleSendLegalInfo(ctx);
                break;
            case 'toggleTestMode':
                await SettingsActions.handleToggleTestMode(ctx);
                break;
            case 'saveLanguageChange':
                await SettingsActions.handleSaveLanguageChange(ctx);
                break;
            case 'deleteAccount':
                await SettingsActions.handleDeleteAccount(ctx);
                break;
            case 'saveFullNameAndBirthYear':
                await SettingsActions.handleSaveFullNameAndBirthYear(ctx);
                break;
            case 'savePhone':
                await SettingsActions.handleSavePhone(ctx);
                break;
            case 'saveCity':
                await SettingsActions.handleSaveCity(ctx);
                break;
            case 'sendOrderApproved':
                await OrderActions.handleSendOrderApproved(ctx);
                break;
            case 'sendOrderProcessing':
                await OrderActions.handleSendOrderProcessing(ctx, actionDef);
                break;
            case 'sendCancelReasonList':
                await OrderActions.handleSendCancelReasonList(ctx);
                break;
            case 'cancelOrderWithReason':
                await OrderActions.handleCancelOrderWithReason(ctx);
                break;
            default:
                actionLog.warn(`Unhandled action type: ${actionDef.type} for action ${actionName}`);
        }
    }

    private async handleSendL10n(actionDef: Action) {
        const key = actionDef.params?.key;
        let lang = actionDef.params?.lang;
        if (lang?.var) {
            const varsContainer = await this.fsm.getData(this.tenantId, this.userId, this.botId);
            lang = getValueByPath(varsContainer, lang.var);
            if (lang == null || lang === '') lang = '1';
        }
        if (!key) return;
        const phrase = await this.getLocalizedText(key, lang);
        await this.sendMessage(phrase);
    }

    public async handleSave(actionDef: Action) {
        const params: any = actionDef.params;
        const savePrefix = (t: string | undefined, name: string) => {
            if (t === 'registration') return `registration.${name}`;
            if (t === 'order') return `order.input.${name}`;
            if (t === 'data' || !t) return `data.${name}`;
            return `_unresolveT.${name}`;
        };
        if (!!params.map && !!params.var) {
            const value = params.map[this.input];
            const var_path = savePrefix(params.var.type, params.var.name);
            const varsContainer = await this.fsm.getData(this.tenantId, this.userId, this.botId);
            const updatedContainer = setValueByPath(varsContainer, var_path, value);
            await this.fsm.setData(this.tenantId, this.userId, updatedContainer, this.botId);
        } else if (!!params.var) {
            const var_path = savePrefix(params.var.type, params.var.name);
            const varsContainer = await this.fsm.getData(this.tenantId, this.userId, this.botId);
            const updatedContainer = setValueByPath(varsContainer, var_path, this.input);
            await this.fsm.setData(this.tenantId, this.userId, updatedContainer, this.botId);
        }
    }

    /** Как в старом register.js: state.data.childrenDocs (camelCase) или data.children_docs */
    private pickChildrenDocsRaw(stored: any): any {
        return (
            stored?.data?.children_docs ??
            stored?.data?.docs ??
            stored?.data?.childrenDocs ??
            stored?.registration?.children_docs ??
            stored?.registration?.childrenDocs ??
            stored?.children_docs ??
            stored?.childrenDocs
        );
    }

    private getChildrenDocsSlice(stored: any): Record<string, { version: string; accepted: string }> | null {
        const children_docs = this.pickChildrenDocsRaw(stored);
        if (children_docs?.public_offer == null) return null;
        return JSON.parse(JSON.stringify(children_docs)) as Record<string, { version: string; accepted: string }>;
    }

    /**
     * Как editUser в старом handlers/register.js (children_collectionCity): массив операций для u_details.
     * @param fillPublicAcceptedIfEmpty — для восстановления профиля: подставить now, если пусто (старое поведение).
     */
    private buildDocsOpsForApi(
        children_docs: Record<string, { version: string; accepted: string }>,
        fillPublicAcceptedIfEmpty: boolean,
    ): any[] {
        if (!children_docs?.public_offer?.version) return [];
        const ts = () => new Date().toUTCString();
        const pubAcc =
            children_docs.public_offer.accepted ||
            (fillPublicAcceptedIfEmpty ? ts() : '');
        return [
            ['=', ['docs', 'public_offer', 'version'], children_docs.public_offer.version],
            ['=', ['docs', 'privacy_policy', 'version'], children_docs.privacy_policy?.version ?? '0'],
            ['=', ['docs', 'legal_information', 'version'], children_docs.legal_information?.version ?? '0'],
            ['=', ['docs', 'public_offer', 'accepted'], pubAcc],
            ['=', ['docs', 'privacy_policy', 'accepted'], children_docs.privacy_policy?.accepted ?? ''],
            ['=', ['docs', 'legal_information', 'accepted'], children_docs.legal_information?.accepted ?? ''],
        ];
    }

    /** Операции для editUserProfile (восстановление удалённого): порядок как в старом editUser после docs */
    private buildDocsOps(stored: any): any[] {
        const slice = this.getChildrenDocsSlice(stored);
        return slice ? this.buildDocsOpsForApi(slice, true) : [];
    }

    private async handleRegister() {
        await this.ensureApiDataLoaded();
        await DocsActions.ensureChildrenDocsInFsm(this.createContext());
        const stored = await this.fsm.getData(this.tenantId, this.userId, this.botId);
        const reg = getRegistrationSlice(stored);
        const idField = this.getIdField();
        const lang = reg.lang ?? stored?.selectedLanguage ?? '1';
        const city = reg.city;
        const fullName = reg.firstName && reg.lastName
            ? `${reg.firstName} ${reg.lastName}`
            : (reg.fullName ?? '');
        const phone = reg.phone;
        const birthYear = reg.birthYear;

        const fsmDocs = this.getChildrenDocsSlice(stored);
        const docsForRegister = DocsActions.combineDocsForRegisterPayload(fsmDocs, this.apiManager);
        const docsOpsRecover = this.buildDocsOps(stored);

        const register_data = {
            u_details: {
                birthYear: String(birthYear ?? ''),
                phone: String(phone ?? ''),
                cityString: String(city ?? ''),
                docs: docsForRegister,
            },
        };

        const userPayload = {
            ...idField,
            u_role: 1,
            u_name: fullName,
            lang,
            u_details: {
                birthYear,
                city,
                cityString: city,
            },
            register_data,
        };
        let recovered = false;
        try {
            const profileRes = await this.apiManager?.getProfile?.(idField);
            const isDeleted = profileRes?.status === 'success' && profileRes?.data?.user
                ? (() => {
                    const keys = Object.keys(profileRes.data.user);
                    const profile = keys.length ? profileRes.data.user[keys[0]] : null;
                    return profile?.u_details?.deleted === '1';
                })()
                : false;

            if (isDeleted) {
                recovered = true;
                const u_details: any[] = [
                    ...docsOpsRecover,
                    ['=', ['birthYear'], birthYear ?? ''],
                    ['=', ['phone'], phone ?? ''],
                    ['=', ['cityString'], city ?? ''],
                    ['=', ['deleted'], '0'],
                ];
                const res = await this.apiManager?.editUserProfile?.(idField, { u_name: fullName, u_details });
                if (res?.status !== 'success') throw new Error(res?.message ?? 'Recover failed');
                await this.apiManager?.changeUserLang?.(idField, lang);
            } else if (this.apiManager?.register) {
                await this.apiManager.register(userPayload);
            } else if (this.taskManager) {
                await this.taskManager.enqueueTask(this.tenantId, { type: 'register', user: userPayload });
            }
            await this.fsm.mergeData(this.tenantId, this.userId, { registered: true }, this.botId);
            const cur = await this.fsm.getData(this.tenantId, this.userId, this.botId);
            if (cur && typeof cur === 'object') {
                delete (cur as any).registration;
                await this.fsm.setData(this.tenantId, this.userId, cur, this.botId);
            }
            logBusinessEvent('user.registered', {
                tenantId: this.tenantId,
                userId: this.userId,
                botId: this.botId,
                chatId: String(this.chatId),
                recovered,
                ...idField,
            });
        } catch (error) {
            actionLog.error('register flow failed', { error });
            if (this.taskManager) {
                await this.taskManager.enqueueTask(this.tenantId, { type: 'register', user: userPayload });
            }
        }
    }

    private async handleDataOperation(actionDef: Action) {
        const operation = actionDef.operation;
        const path = actionDef.path;
        switch (operation) {
            case 'merge':
                if (actionDef.params) {
                    await this.fsm.mergeData(this.tenantId, this.userId, actionDef.params, this.botId);
                }
                break;
            case 'reset':
                if (path) {
                    const current = await this.fsm.getData(this.tenantId, this.userId, this.botId);
                    delete current[path];
                    await this.fsm.setData(this.tenantId, this.userId, current, this.botId);
                }
                break;
            case 'clear':
                await this.fsm.setData(this.tenantId, this.userId, {}, this.botId);
                break;
        }
    }

    private async handleSendBotLegalDocs(actionDef: Action) {
        const key: string = actionDef.params?.key;
        if (!key) return;
        await DocsActions.ensureChildrenDocsInFsm(this.createContext());
        let lang = actionDef.params?.lang;
        if (lang?.var) {
            const varsContainer = await this.fsm.getData(this.tenantId, this.userId, this.botId);
            lang = getValueByPath(varsContainer, lang.var);
            if (lang == null || lang === '') lang = '1';
        }
        const getValueSafe = (obj: any, path: string, defaultValue?: any) => {
            try {
                return path.split('.').reduce((acc, k) => acc?.[k], obj) ?? defaultValue;
            } catch {
                return defaultValue;
            }
        };
        const bot_legal_docs: BotLegalDoc = getValueSafe(this.apiManager?.api_data_manager?.data?.data, key);
        if (!bot_legal_docs) return;
        let max_version = 0;
        for (const i of bot_legal_docs.content || []) {
            if (Number(i.version) > max_version) max_version = Number(i.version);
        }
        const max_version_block = bot_legal_docs.content?.find((x: any) => Number(x.version) === max_version)?.parts;
        const texts: string[] = [];
        if (max_version_block) {
            for (const i of max_version_block) {
                const t = (i as any)[lang as string] ?? (i as any)['1'];
                if (t) texts.push(t);
            }
        }
        const replaceList = actionDef?.params?.replace as
            | Record<string, { key: string; lang: string | { var: string } }>
            | undefined;
        if (replaceList) {
            const varsForReplace = await this.fsm.getData(this.tenantId, this.userId, this.botId);
            for (const [rkey, value] of Object.entries(replaceList)) {
                let replLang: string | undefined = value.lang as string;
                if (typeof value.lang === 'object' && value.lang?.var) {
                    replLang = getValueByPath(varsForReplace, value.lang.var);
                    if (replLang == null || replLang === '') replLang = '1';
                }
                const replacementText = await this.getLocalizedText(value.key, replLang);
                for (let i = 0; i < texts.length; i++) {
                    if (texts[i].includes(rkey)) texts[i] = texts[i].replace(rkey, replacementText);
                }
            }
        }
        for (const text of texts) {
            await this.sendMessage(text);
            await new Promise(r => setTimeout(r, 300));
        }
    }
}
