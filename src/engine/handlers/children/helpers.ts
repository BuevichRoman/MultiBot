// /engine/handlers/children/helpers.ts

import { Orchestrator } from '../../../newManagers/orchestrator/Orchestrator';
import { FSMManager } from '../../managers/FSMManager';
import {TenantSchema, Action, ValidationRule} from '../../types';
import { ActionExecutorOptions, BotLegalDoc, SendL10nParams, SendBotLegalDocsParams, SaveParams, SendBotLegalDocsReplaceItem } from './types';
import { getTaggedLogger } from '../../../addons/logger';

const helpersActLog = getTaggedLogger('children-helpers');

// Утилиты для работы с объектами
export function getValueByPath(obj: any, path: string): any {
    if (!obj || !path) return undefined;
    return path.split('.').reduce((acc, key) => acc?.[key], obj);
}

export function setValueByPath(obj: any, path: string, value: any): any {
    const keys = path.split('.');
    let current = obj;

    for (let i = 0; i < keys.length - 1; i++) {
        const key = keys[i];
        if (!current[key] || typeof current[key] !== 'object') {
            current[key] = {};
        }
        current = current[key];
    }

    const lastKey = keys[keys.length - 1];
    current[lastKey] = value;

    return obj;
}

const validateInput = (
    input: string,
    validation: ValidationRule
): {
    isValid: boolean;
    event: string;
    data?: Record<string, any>
} => {
    const trimmedInput = input.trim();

    // 1. СНАЧАЛА ПРОВЕРЯЕМ МАППИНГ (точное совпадение)
    if (validation.mapping && validation.mapping[trimmedInput]) {
        const mapping = validation.mapping[trimmedInput];
        return {
            isValid: true,
            event: mapping.event,
            data: validation.saveAs
                ? { [validation.saveAs]: trimmedInput }
                : undefined
        };
    }

    // 2. ЕСЛИ НЕТ МАППИНГА - ИСПОЛЬЗУЕМ СТАНДАРТНУЮ ВАЛИДАЦИЮ
    switch (validation.type) {
        case 'choice':
            if (!validation.allowed) {
                return { isValid: false, event: validation.errorEvent };
            }

            const isValid = validation.allowed.includes(trimmedInput);

            if (!isValid) {
                return { isValid: false, event: validation.errorEvent };
            }

            return {
                isValid: true,
                event: validation.successEvent ?? 'ok',
                data: validation.saveAs
                    ? { [validation.saveAs]: trimmedInput }
                    : undefined
            };

        case 'regex':
            if (!validation.pattern) {
                return { isValid: false, event: validation.errorEvent };
            }

            const regex = new RegExp(validation.pattern);
            const matches = trimmedInput.match(regex);
            const isMatch = !!matches;

            if (!isMatch) {
                return { isValid: false, event: validation.errorEvent };
            }

            // Сохраняем данные из regex групп
            let data: Record<string, any> = {};

            if (validation.saveAs) {
                data[validation.saveAs] = trimmedInput;
            }

            if (validation.saveFields && matches) {
                validation.saveFields.forEach(field => {
                    if (field.from.startsWith('parts[')) {
                        const index = parseInt(field.from.match(/\[(\d+)\]/)?.[1] || '0');
                        if (matches[index] !== undefined) {
                            data[field.to] = matches[index];
                        }
                    } else {
                        data[field.to] = trimmedInput;
                    }
                });
            }

            return {
                isValid: true,
                event: validation.successEvent ?? 'ok',
                data
            };

        case 'range':
            if (validation.min === undefined || validation.max === undefined) {
                return { isValid: false, event: validation.errorEvent };
            }

            const numValue = parseFloat(trimmedInput);
            const isInRange = !isNaN(numValue) &&
                numValue >= validation.min &&
                numValue <= validation.max;

            if (!isInRange) {
                return { isValid: false, event: validation.errorEvent };
            }

            return {
                isValid: true,
                event: validation.successEvent ?? 'ok',
                data: validation.saveAs
                    ? { [validation.saveAs]: numValue }
                    : undefined
            };

        default:
            return { isValid: false, event: validation.errorEvent };
    }
};


// Класс для выполнения действий
export class ActionExecutor {
    private fsm: FSMManager;
    private orchestrator: Orchestrator;
    private schema: TenantSchema;
    private botId: string;
    private chatId: string;
    private input: string;
    private tenantId: string;
    private currentState: string;
    private apiManager: any;

    constructor(options: ActionExecutorOptions) {
        this.fsm = options.fsm;
        this.orchestrator = options.orchestrator;
        this.schema = options.schema;
        this.botId = options.botId;
        this.chatId = options.chatId;
        this.input = options.input;
        this.tenantId = options.tenantId;
        this.currentState = options.currentState;
        this.apiManager = options.apiManager;
    }

    async execute(actions: string[] | undefined): Promise<void> {
        if (!actions?.length) return;

        for (const actionName of actions) {
            const actionDef = this.findAction(actionName);
            if (!actionDef) {
                helpersActLog.warn(`Action not found: ${actionName}`);
                continue;
            }

            await this.executeAction(actionName, actionDef);
        }
    }

    private findAction(actionName: string): Action | undefined {
        // Сначала ищем в глобальных actions
        if (this.schema.actions?.[actionName]) {
            return this.schema.actions[actionName];
        }

        // Затем ищем в actions текущего состояния
        for (const flow of Object.values(this.schema.flows || {})) {
            if (flow.states?.[this.currentState]?.actions?.[actionName]) {
                return flow.states[this.currentState].actions?.[actionName];
            }
        }

        return undefined;
    }

    private async executeAction(actionName: string, actionDef: Action): Promise<void> {
        switch (actionDef.type) {
            case 'sendL10n':
                await this.handleSendL10n(actionDef);
                break;

            case 'sendBotLegalDocs':
                await this.handleSendBotLegalDocs(actionDef);
                break;

            case 'apiCall':
                await this.handleApiCall(actionDef);
                break;

            case 'save':
                await this.handleSave(actionDef);
                break;

            case 'data':
                await this.handleDataOperation(actionDef);
                break;

            default:
                helpersActLog.warn(`Unhandled action type: ${actionDef.type} for ${actionName}`);
        }
    }

    private async handleSendL10n(actionDef: Action): Promise<void> {
        const params = actionDef.params as SendL10nParams;
        const key = params?.key;
        if (!key) return;

        let lang = params?.lang;
        if (lang && typeof lang === 'object' && 'var' in lang) {
            const data = await this.fsm.getData(this.tenantId, this.chatId, this.botId);
            lang = getValueByPath(data, lang.var);
        }

        const adapter = this.orchestrator.getAdapter(this.botId) as any;
        if (!adapter?.sendMessage) return;

        // Получаем локализованный текст
        let text = key;
        try {
            if (this.apiManager?.api_data_manager?.isLoaded) {
                text = await this.apiManager.api_data_manager.getLangValueItem(
                    key.toLowerCase(),
                    lang || '1'
                );
            }
        } catch (e) {
            helpersActLog.error('Error getting localized text', { key, error: e });
        }

        await adapter.sendMessage(this.chatId, text);
    }

    private async handleSendBotLegalDocs(actionDef: Action): Promise<void> {
        const params = actionDef.params as SendBotLegalDocsParams;
        const key = params?.key;
        if (!key || !this.apiManager?.api_data_manager?.data) return;

        let lang = params?.lang;
        if (lang && typeof lang === 'object' && 'var' in lang) {
            const data = await this.fsm.getData(this.tenantId, this.chatId, this.botId);
            lang = getValueByPath(data, lang.var);
        }

        // Получаем документ
        const botLegalDocs = getValueByPath(
            this.apiManager.api_data_manager.data,
            key
        ) as BotLegalDoc;

        if (!botLegalDocs) return;

        // Находим последнюю версию
        const maxVersion = Math.max(...botLegalDocs.content.map(c => c.version));
        const latestVersion = botLegalDocs.content.find(c => c.version === maxVersion);

        if (!latestVersion?.parts) return;

        // Получаем тексты
        let texts = latestVersion.parts.map(part => part[lang as string || '1']);

        // Заменяем плейсхолдеры
        if (params.replace) {
            for (const [placeholder, replaceConfig] of Object.entries(params.replace) as [string, SendBotLegalDocsReplaceItem][]) {
                const replacementText = await this.getLocalizedText(
                    replaceConfig.key,
                    replaceConfig.lang
                );

                texts = texts.map(t => t.replace(placeholder, replacementText));
            }
        }

        // Отправляем
        const adapter = this.orchestrator.getAdapter(this.botId) as any;
        if (adapter?.sendMessage) {
            for (const text of texts) {
                await adapter.sendMessage(this.chatId, text);
            }
        }
    }

    private async handleSave(actionDef: Action): Promise<void> {
        const params = actionDef.params as SaveParams;

        if (params.map && params.var) {
            // Сохраняем через маппинг
            const value = params.map[this.input];
            const varPath = params.var.type === 'data' ? params.var.name : `_unresolved.${params.var.name}`;

            const data = await this.fsm.getData(this.tenantId, this.chatId, this.botId);
            const updatedData = setValueByPath(data, varPath, value);
            await this.fsm.setData(this.tenantId, this.chatId, updatedData, this.botId);
        } else if (params.value && params.var) {
            // Прямое сохранение значения
            const data = await this.fsm.getData(this.tenantId, this.chatId, this.botId);
            const updatedData = setValueByPath(data, params.var.name, params.value);
            await this.fsm.setData(this.tenantId, this.chatId, updatedData, this.botId);
        }
    }

    private async handleApiCall(actionDef: Action): Promise<void> {
        const params = actionDef.params as { endpoint: string; method?: string; data?: any };

        if (params.endpoint === '/register') {
            await this.handleRegister();
        }
        // Другие API вызовы
    }

    private async handleRegister(): Promise<void> {
        const data = await this.fsm.getData(this.tenantId, this.chatId, this.botId);
        const adapter = this.orchestrator.getAdapter(this.botId);

        // Определяем ID в зависимости от адаптера
        let idField = {};
        if (adapter?.constructor?.name?.includes('Telegram')) {
            idField = { u_tg: this.chatId };
        } else if (adapter?.constructor?.name?.includes('Whatsapp')) {
            idField = { u_wa: this.chatId };
        }

        const userPayload = {
            phone: data.phone,
            u_role: 1,
            ...idField,
            name: data.firstName && data.lastName
                ? `${data.firstName} ${data.lastName}`
                : undefined,
            lang: data.selectedLanguage || data.lang || '1',
            u_details: {
                birthYear: data.birthYear,
                city: data.city,
            },
        };

        try {
            if (this.apiManager?.register) {
                await this.apiManager.register(userPayload);
            }
            await this.fsm.mergeData(this.tenantId, this.chatId, { registered: true }, this.botId);
        } catch (error) {
            helpersActLog.error('Registration failed', { error });
        }
    }

    private async handleDataOperation(actionDef: Action): Promise<void> {
        const operation = actionDef.operation;
        const path = actionDef.path;

        switch (operation) {
            case 'reset':
                if (path) {
                    const data = await this.fsm.getData(this.tenantId, this.chatId, this.botId);
                    delete data[path];
                    await this.fsm.setData(this.tenantId, this.chatId, data, this.botId);
                }
                break;
            case 'clear':
                await this.fsm.setData(this.tenantId, this.chatId, {}, this.botId);
                break;
        }
    }

    private async getLocalizedText(key: string, lang: string): Promise<string> {
        try {
            if (this.apiManager?.api_data_manager?.isLoaded) {
                return await this.apiManager.api_data_manager.getLangValueItem(
                    key.toLowerCase(),
                    lang
                );
            }
        } catch (e) {
            helpersActLog.error('Error getting localized text', { key, error: e });
        }
        return key;
    }
}