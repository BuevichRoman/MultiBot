import { TenantSchema, Action, StateDef, ValidationRule } from '../../types';
import { Orchestrator } from '../../../newManagers/orchestrator/Orchestrator';
import { FSMManager } from '../../managers/FSMManager';
import { APIManager } from '../../../newManagers/api/APIManager';

export interface BotLegalDoc {
    name: {
        [langCode: string]: string;
    };
    content: Array<{
        version: number;
        created: string;
        parts: Array<{
            [langCode: string]: string;
        }>;
    }>;
}

export interface HandlerContext {
    botId: string;
    chatId: string;
    chatIdStr: string;
    text: string;
    tenantId: string;
}

export interface ValidationResult {
    isValid: boolean;
    event: string;
    data?: Record<string, any>;
}

export interface ActionExecutorOptions {
    fsm: FSMManager;
    orchestrator: Orchestrator;
    schema: any;
    botId: string;
    chatId: string;
    input: string;
    tenantId: string;
    currentState: string;
    apiManager: any;
}

export interface SendL10nParams {
    key: string;
    lang?: string | { var: string };
}

export interface SendBotLegalDocsReplaceItem {
    key: string;
    lang: string;
}

export interface SendBotLegalDocsParams {
    key: string;
    lang?: string | { var: string };
    replace?: Record<string, SendBotLegalDocsReplaceItem>;
}

export interface SaveParams {
    map?: Record<string, any>;
    var: { type?: string; name: string };
    value?: any;
}

// Вспомогательные функции для работы с путями
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