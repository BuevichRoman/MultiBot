import { FSMManager } from '../../../managers/FSMManager';
import { Action } from '../../../types';

export interface ActionContext {
    fsm: FSMManager;
    apiManager: any;
    orchestrator: any;
    tenantId: string;
    userId: string;
    chatId: string;
    botId: string;
    input: string;
    sendMessage: (text: string) => Promise<void>;
    sendMessageAndGetId: (text: string) => Promise<string | undefined>;
    getLocalizedText: (key: string, lang?: string) => Promise<string>;
    getIdField: () => Record<string, string>;
    ensureApiDataLoaded: () => Promise<void>;
    getData: () => Promise<any>;
    mergeData: (patch: Record<string, any>) => Promise<void>;
    setData: (data: any) => Promise<void>;
    taskManager: any;
}
