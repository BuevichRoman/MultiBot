import { BaseHandler } from './BaseHandler';
import { getTaggedLogger } from '../../../addons/logger';

const regHandlerLog = getTaggedLogger('RegistrationHandler');
import { TenantSchema,ValidationRule } from '../../types';

export class RegistrationHandler extends BaseHandler {
    canHandle(currentState: string): boolean {
        return currentState.startsWith('registration.');
    }

    async handle(ctx: any, currentState: string): Promise<void> {
        const { botId, chatId, userId, text } = ctx;
        const chatIdStr = String(chatId);
        const userIdStr = String(userId ?? chatId);

        // 1. Загружаем схему
        const schema = await this.fsm.loadSchema(this.tenantId);

        // 2. Асинхронная загрузка API данных
        this.getApiManager(); // Инициализируем менеджеры
        this.ensureApiDataLoaded().catch(() => { });

        // 3. Определяем событие с валидацией
        const { event, data } = await this.determineEvent(currentState, text || '', schema);

        // 4. Сохраняем данные от валидации, если есть
        if (data) {
            await this.fsm.mergeData(this.tenantId, userIdStr, { registration: data }, botId);
        }

        // 5. Выполняем переход
        const result = await this.fsm.transition(this.tenantId, userIdStr, event, botId);

        // 6. Создаем исполнитель действий
        const executor = this.createExecutor(
            schema,
            botId,
            chatIdStr,
            userIdStr,
            text?.trim() || '',
            currentState
        );

        // 7. Выполняем действия перехода
        if (result.actions?.length) {
            await executor.execute(result.actions);
        }

        // 8. Выполняем entryActions нового состояния
        if (result.to) {
            const entryActions = this.fsm.getEntryActions(this.tenantId, result.to);
            if (entryActions?.length) {
                await executor.execute(entryActions);
            }
        }
    }

    private async ensureApiDataLoaded() {
        const { apiManager } = this.getApiManager();
        if (apiManager?.api_data_manager && !apiManager.api_data_manager.isLoaded) {
            try {
                await apiManager.api_data_manager.load();
            } catch (e) {
                regHandlerLog.error('Failed to load API data', { error: e });
            }
        }
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
            const noSaveEvents = ['cancel', 'back', 'validation_failed'];
            const saveKey = validation.saveAs;
            const shouldSave = saveKey && !noSaveEvents.includes(mapping.event);
            return {
                isValid: true,
                event: mapping.event,
                data: shouldSave && saveKey ? { [saveKey]: trimmedInput } : undefined
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

    private async determineEvent(
        state: string,
        text: string,
        schema: TenantSchema
    ): Promise<{ event: string; data?: Record<string, any> }> {
        const trimmedText = text?.trim() || '';

        // Находим состояние в схеме
        let stateDef: any = await this.getStateDef(schema, state);

        // Если есть валидация - используем её
        if (stateDef?.validation) {
            const inputForValidation = state.startsWith('registration.children_docs_')
                ? trimmedText.toLowerCase()
                : trimmedText;
            const result = this.validateInput(inputForValidation, stateDef?.validation);
            return { event: result.event, data: result.data };
        }

        if (state === "registration.collectionFullName") {
            const parts = trimmedText
                .replace(/\s{2,}/g, ' ')
                .trim()
                .split(' ');
            if (parts.length !== 3) {
                return { event: 'full_name_invalid' };
            }
            const year = parts[2];
            if (!/^\d{4}$/.test(year)) return { event: 'full_name_invalid' };
            if (Number(year) + 18 > new Date().getFullYear()) return { event: 'full_name_invalid' };

            return {
                event: 'full_name_valid',
                data: {
                    birthYear: year,
                    firstName: parts[0],
                    lastName: parts[1]
                }
            };
        }

        return { event: 'message' };
    }
}