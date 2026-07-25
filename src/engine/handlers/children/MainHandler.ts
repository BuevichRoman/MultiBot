import { BaseHandler } from './BaseHandler';
import { TenantSchema, ValidationRule } from '../../types';
import { setValueByPath } from './types';
import { ActionExecutor } from './ActionExecutor';
import { TelegramBotPollingAdaptor, WhatsappWebPollingAdaptor } from '../../../transport';
import TestAdapter from '../../../transport/TestAdapter/TestAdapter';
import { parseDriverSelection, parseWhen, parseFromInput } from '../../children/parsers';
import { fsmPathFromSaveType } from './fsmStorage';
import { checkDocsNeedUpdate } from '../../children/docs/docsHelpers';
import { getTaggedLogger } from '../../../addons/logger';

const mainHandlerLog = getTaggedLogger('MainHandler');

export class MainHandler extends BaseHandler {
    canHandle(currentState: string): boolean {
        return currentState.startsWith('main.') || currentState.startsWith('order.');
    }
    private validateInput(
        input: string,
        validation: ValidationRule
    ): {
        isValid: boolean;
        event: string;
        data?: Record<string, any>;
    } {
        const trimmedInput = input.trim();

        // 1. СНАЧАЛА ПРОВЕРЯЕМ МАППИНГ (точное совпадение)
        if (validation.mapping && validation.mapping[trimmedInput]) {
            const mapping = validation.mapping[trimmedInput];
            let data = mapping.data;
            if (validation.saveAs) {
                data = { ...(data || {}), [validation.saveAs]: trimmedInput };
            }
            return {
                isValid: true,
                event: mapping.event,
                data
            };
        }

        // 2. type "mapping": только маппинг, при отсутствии совпадения — errorEvent
        if (validation.type === 'mapping' || (validation.mapping && !validation.type)) {
            return { isValid: false, event: validation.errorEvent };
        }

        // 3. СТАНДАРТНАЯ ВАЛИДАЦИЯ (choice, regex, range)
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
                    validation.saveFields.forEach((field: any) => {
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
    }

    async handle(ctx: any, currentState: string): Promise<void> {
        const { botId, chatId, userId, text, location } = ctx;
        const chatIdStr = String(chatId);
        const userIdStr = String(userId ?? chatId);

        // 1. Загружаем схему
        const schema = await this.fsm.loadSchema(this.tenantId);

        // 5. Создаем исполнитель действий
        const executor = this.createExecutor(
            schema,
            botId,
            chatIdStr,
            userIdStr,
            text?.trim() || '',
            currentState
        );

        // 2. System event (drivers_found, no_drivers) — используем ctx.event, merge payload
        let event: string;
        let data: Record<string, any> | undefined;
        if (ctx.isSystemEvent && ctx.event) {
            event = ctx.event;
            if (event === 'drivers_found' && ctx.payload) {
                const p = ctx.payload as Record<string, unknown>;
                await this.fsm.mergeData(
                    this.tenantId,
                    userIdStr,
                    {
                        order: { input: { driversMap: p.driversMap, driversListText: p.listText } },
                    },
                    botId,
                );
            }
        } else {
            const determined = await this.determineEvent(
                executor,
                currentState,
                schema,
                userIdStr,
                botId,
                text || '',
                location,
            );
            event = determined.event;
            data = determined.data;
        }

        // 3. Сохраняем данные от валидации, если есть
        if (data) {
            await this.fsm.mergeData(this.tenantId, userIdStr, data, botId);
        }

        // 3b. При переходе в cancelReason — сохраняем откуда пришли
        if (event === 'cancel_reason_request') {
            await this.fsm.mergeData(
                this.tenantId,
                userIdStr,
                {
                    'order.input.cancelReasonFromState': currentState,
                },
                botId,
            );
        }

        // 4. Выполняем переход
        const result = await this.fsm.transition(this.tenantId, userIdStr, event, botId);



        // 6. Выполняем действия перехода
        if (result.actions?.length) {
            await executor.execute(result.actions);
        }

        // 7. Выполняем entryActions нового состояния
        if (result.to) {
            const entryActions = this.fsm.getEntryActions(this.tenantId, result.to);
            if (entryActions?.length) {
                await executor.execute(entryActions);
            }
        }
    }

    private async determineEvent(
        executor: ActionExecutor,
        state: string,
        schema: TenantSchema,
        userIdStr: string,
        botId: string,
        text: string,
        location?: {
            latitude: string,
            longitude: string,
            live: boolean
        },
    ): Promise<{ event: string; data?: Record<string, any> }> {
        const trimmedText = text?.trim() || '';
        // Находим состояние в схеме
        const stateDef = await this.getStateDef(schema, state);

        // Children tenant: проверка документов при переходе в создание заказа (main.start/main.default, "0")
        if (state === 'main.start' || state === 'main.default') {
            mainHandlerLog.debug('main.start/default (docs gate)', {
                userId: userIdStr,
                state,
                trimmedTextLength: trimmedText?.length,
                botId,
            });
        }
        if ((state === 'main.start' || state === 'main.default') && trimmedText === '0') {
            const needUpdate = await checkDocsNeedUpdate(this.getApiManager(), this.orchestrator, userIdStr, botId);
            if (needUpdate) {
                return { event: 'docs_needed' };
            }
        }

        // Обрабатываем location type
        if (location && stateDef?.location) {
            const dataContainer = await this.fsm.getData(this.tenantId, userIdStr, botId);
            const latPath = fsmPathFromSaveType(
                stateDef.location.save.latitude.type,
                stateDef.location.save.latitude.name,
            );
            const lngPath = fsmPathFromSaveType(
                stateDef.location.save.longitude.type,
                stateDef.location.save.longitude.name,
            );
            await setValueByPath(dataContainer, latPath, location.latitude);
            await setValueByPath(dataContainer, lngPath, location.longitude);
            await this.fsm.mergeData(this.tenantId, userIdStr, dataContainer, botId);
            return { event: 'ok' };
        }

        if (state === 'main.from') {
            const coords = parseFromInput(text);
            if (coords) {
                const dataContainer = await this.fsm.getData(this.tenantId, userIdStr, botId);
                await setValueByPath(dataContainer, 'order.input.latitude', coords.latitude);
                await setValueByPath(dataContainer, 'order.input.longitude', coords.longitude);
                await this.fsm.mergeData(this.tenantId, userIdStr, dataContainer, botId);
                return { event: 'ok' };
            }
            // "9"→help и прочее — из validation в JSON
            if (stateDef?.validation) {
                const result = this.validateInput(trimmedText, stateDef.validation);
                return { event: result.event, data: result.data };
            }
            return { event: 'error' };
        }

        // main.options: "0"→skip из JSON; иначе id опций (whitelist/tokenMap из схемы + booking_comments API)
        if (state === 'main.options') {
            if (stateDef?.validation) {
                const result = this.validateInput(trimmedText, stateDef.validation);
                if (result.event === 'skip') return { event: 'skip', data: result.data };
            }
            const bookingComments = this.getApiManager()?.api_data_manager?.data?.data?.booking_comments;
            if (!bookingComments) {
                return { event: 'error' };
            }
            const v = stateDef?.validation;
            const tokenMap = v?.additionalOptionsTokenMap;
            const allowed = v?.additionalOptionsAllowed;
            const parts = trimmedText.replace(/\s{2,}/g, ' ').split(' ').filter(Boolean);
            const ids: number[] = [];
            for (const idStr of parts) {
                if (allowed?.length && !allowed.includes(idStr)) {
                    return { event: 'error' };
                }
                const numericId = tokenMap && idStr in tokenMap ? tokenMap[idStr] : Number(idStr);
                if (!Number.isFinite(numericId) || numericId < 0) {
                    return { event: 'error' };
                }
                const key = String(numericId);
                const comment = bookingComments[key];
                if (!comment || (comment as { options?: { hidden?: boolean } }).options?.hidden) {
                    return { event: 'error' };
                }
                ids.push(numericId);
            }
            return { event: 'ok', data: { 'order.input.additionalOptions': ids } };
        }

        // main.driverList: "0"→exit из JSON; иначе parseDriverSelection (требует driversMap)
        if (state === 'main.driverList') {
            if (stateDef?.validation) {
                const result = this.validateInput(trimmedText, stateDef.validation);
                if (result.event === 'exit') return { event: 'exit' };
            }
            const stateData = await this.fsm.getData(this.tenantId, userIdStr, botId);
            const driversMap = (
                stateData?.order?.input?.driversMap ??
                stateData?.driversMap ??
                stateData?.data?.driversMap
            ) as Record<string, string> | undefined;
            if (!driversMap || typeof driversMap !== 'object') {
                return { event: 'error' };
            }
            const getLang = async (key: string) => {
                const mgr = this.getApiManager()?.api_data_manager;
                if (mgr && !mgr.isLoaded) await mgr.load();
                return mgr?.getLangValueItem?.(key.toLowerCase(), '1') ?? key;
            };
            const parseResult = await parseDriverSelection(trimmedText, driversMap, getLang);
            if ('error' in parseResult) {
                return { event: 'error', data: { 'order.input.driverSelectionErrorMessage': parseResult.error } };
            }
            return { event: 'ok', data: { 'order.input.preferredDriversList': parseResult.selected } };
        }

        // order.start, approved, driverArrived, driverStarted: "0"→cancel_reason_request — из validation в JSON

        // order.cancelReason: "01" → возврат (event зависит от fromState — динамика в коде)
        if (state === 'order.cancelReason' && trimmedText === '01') {
            const container = await this.fsm.getData(this.tenantId, userIdStr, botId);
            const fromState =
                container?.order?.input?.cancelReasonFromState ??
                container?.data?.cancelReasonFromState ??
                'order.start';
            const eventMap: Record<string, string> = {
                'order.start': 'cancel_back_to_start',
                'order.approved': 'cancel_back_to_approved',
                'order.driverArrived': 'cancel_back_to_driverArrived',
                'order.driverStarted': 'cancel_back_to_driverStarted',
            };
            return { event: eventMap[fromState] ?? 'cancel_back_to_start' };
        }

        // order.completed, order.review — validation в JSON (mapping + choice/regex + saveAs)

        // main.when: "2"/"сейчас" → null, иначе парсим время (UTC), проверяем что не в прошлом
        if (state === 'main.when') {
            const tomorrowMarker = 'завтра';
            const parsed = parseWhen(trimmedText,60, tomorrowMarker);
            if (parsed === undefined) {
                return { event: 'error' };
            }
            const nowUtc = new Date();
            if (parsed !== null && nowUtc.getTime() > parsed.getTime()) {
                return { event: 'error' };
            }
            const dataContainer = await this.fsm.getData(this.tenantId, userIdStr, botId);
            setValueByPath(dataContainer, 'order.input.when', parsed);
            await this.fsm.mergeData(this.tenantId, userIdStr, dataContainer, botId);
            return { event: 'ok' };
        }

        // Если есть валидация - используем её
        if (stateDef?.validation) {
            const result = this.validateInput(trimmedText, stateDef?.validation);
            return {
                event: result.event,
                data: result.data
            };
        }

        return { event: 'message' };
    }
}