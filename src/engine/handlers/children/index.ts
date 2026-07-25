import { Orchestrator } from '../../../newManagers/orchestrator/Orchestrator';
import Engine from '../../index';
import { RegistrationHandler } from './RegistrationHandler';
import { MainHandler } from './MainHandler';
import { SettingsHandler } from './SettingsHandler';
import { APIManager } from '../../../newManagers/api/APIManager';
import {TelegramBotPollingAdaptor, WhatsappWebPollingAdaptor} from "../../../transport";
import TestAdapter from "../../../transport/TestAdapter/TestAdapter";
import { getTaggedLogger } from '../../../addons/logger';

const childrenLog = getTaggedLogger('children');

const flowDebug = () => process.env.CHILDREN_HANDLER_DEBUG === '1';

export function makeChildrenHandler(orchestrator: Orchestrator,
                                    engine: Engine,
                                    apiManager?: APIManager) {
    const fsm = engine.getFSMManager();
    const tenantId = 'children';

    // Создаем хендлеры
    const registrationHandler = new RegistrationHandler(orchestrator, fsm, apiManager);
    const mainHandler = new MainHandler(orchestrator, fsm, apiManager);
    const settingsHandler = new SettingsHandler(orchestrator, fsm, apiManager);

    const determineFlow = async (
        schema: any,
        userData: any,
        message: any,
        botId: string,
        userId: string,
    ): Promise<string | null> => {
        const flowSelection = schema.flowSelection;
        let idField = {};

        if (orchestrator.getAdapter(botId) instanceof TelegramBotPollingAdaptor || orchestrator.getAdapter(botId) instanceof TestAdapter) {
            idField = { u_a_tg: userId };
        } else if (orchestrator.getAdapter(botId) instanceof WhatsappWebPollingAdaptor) {
            idField = { u_a_wa: userId };
        } else {
            idField = { chatId: userId };
        }

        const profileRes = await apiManager?.getProfile(idField);
        const isRegistered = profileRes?.status === 'success';
        let profile: any = null;
        if (isRegistered && profileRes?.data?.user) {
            const k = Object.keys(profileRes.data.user);
            profile = k.length ? profileRes.data.user[k[0]] : null;
        }
        const isDeleted = profile?.u_details?.deleted === '1';

        if (isRegistered && profile) {
            const userVar = {
                lang: profile.u_lang,
                role: profile.u_role,
                name: profile.u_name,
                lastName: profile.u_family,
                id: profile.u_id,
                city: profile.u_city,
                details: profile.u_details || {}
            };
            await fsm.mergeData(tenantId, userId, { user: userVar }, botId);
        }

        if (!flowSelection?.flows?.length) {
            return null;
        }

        const context = {
            user: userData || {},
            message: { text: message?.text || '' },
            isRegistered,
            isDeleted
        };

        for (const flow of flowSelection.flows) {
            if (flow.condition) {
                try {
                    const fn = new Function('context', `
                        const { user, message, isRegistered, isDeleted } = context;
                        return ${flow.condition};
                    `);
                    if (fn(context)) {
                        if (flowDebug()) childrenLog.info(`flow matched: ${flow.name}`);
                        return flow.name;
                    }
                } catch (e) {
                    childrenLog.error(`flow condition error (${flow.name})`, { error: e });
                }
            }

            if (flow.default) {
                if (flowDebug()) childrenLog.info(`flow default: ${flow.name}`);
                return flow.name;
            }
        }

        return null;
    };

    return async function childrenHandler(ctx: any) {
        const { botId, chatId, userId, text } = ctx;
        const chatIdStr = String(chatId);
        const userIdStr = String(userId ?? chatId);

        const adapter = orchestrator.getAdapter(botId) as any;
        if (!adapter) return;

        // 1. Загружаем схему
        const schema = await fsm.loadSchema(tenantId);

        // 2. Получаем текущее состояние (всегда по userId)
        let currentState = await fsm.getState(tenantId, userIdStr, botId);

        // 3. Если состояния нет - определяем поток через flowSelection
        if (!currentState) {
            if (flowDebug()) childrenLog.info(`no state for ${userIdStr}, determineFlow`);

            const userData = await fsm.getData(tenantId, userIdStr, botId);
            const selectedFlow = await determineFlow(schema, userData, { text }, botId, userIdStr);

            if (selectedFlow) {
                const flow = schema.flows?.[selectedFlow];
                if (flow) {
                    const startState = Object.keys(flow.states || {}).find(id =>
                        id === `${selectedFlow}.start` || id.endsWith('.start')
                    );

                    if (startState) {
                        currentState = startState;
                        await fsm.setState(tenantId, userIdStr, currentState, botId);
                        if (flowDebug()) {
                            childrenLog.info(`start state ${currentState} (flow ${selectedFlow})`);
                        }
                    }
                }
            }

            if (!currentState) {
                currentState = schema.initialState;
                await fsm.setState(tenantId, userIdStr, currentState, botId);
                if (flowDebug()) childrenLog.info(`fallback initialState: ${currentState}`);
            }
        }

        // 4. Выбираем хендлер
        let handler;
        if (registrationHandler.canHandle(currentState)) {
            handler = registrationHandler;
        } else if (settingsHandler.canHandle(currentState)) {
            handler = settingsHandler;
        } else if (mainHandler.canHandle(currentState)) {
            handler = mainHandler;
        } else {
            childrenLog.warn(`no handler for state: ${currentState}`);
            if (adapter?.sendMessage) {
                await adapter.sendMessage(chatIdStr, 'Извините, произошла ошибка. Попробуйте позже.');
            }
            return;
        }

        // 5. Передаем управление хендлеру
        await handler.handle(ctx, currentState);
    };
}

// Экспорты
export { RegistrationHandler, MainHandler, SettingsHandler };