import { BaseHandler } from './BaseHandler';
import { ValidationRule } from '../../types';

export class SettingsHandler extends BaseHandler {
    canHandle(currentState: string): boolean {
        return currentState.startsWith('settings.');
    }

    private determineEventForCustomState(state: string, input: string): { event: string; data?: Record<string, any> } | null {
        const t = input.trim();
        if (state === 'settings.collectionFullNameAndBirthYear') {
            const parts = t.split(/\s+/);
            if (parts.length !== 3) return { event: 'error' };
            const year = parts[2].trim();
            if (!/^[0-9]{4}$/.test(year)) return { event: 'error' };
            if (new Date().getFullYear() - Number(year) < 18) return { event: 'error' };
            const fullName = `${parts[0]} ${parts[1]}`;
            return { event: 'ok', data: { 'data.fullName': fullName, 'data.birthYear': year } };
        }
        return null;
    }

    private validateInput(
        input: string,
        validation: ValidationRule
    ): { isValid: boolean; event: string; data?: Record<string, any> } {
        const trimmedInput = input.trim();

        if (validation.mapping && validation.mapping[trimmedInput]) {
            const mapping = validation.mapping[trimmedInput];
            const noSaveEvents = ['cancel', 'back'];
            const shouldSave = validation.saveAs && !noSaveEvents.includes(mapping.event);
            return {
                isValid: true,
                event: mapping.event,
                data: shouldSave ? { [validation.saveAs!]: trimmedInput } : undefined
            };
        }

        switch (validation.type) {
            case 'choice':
                if (!validation.allowed) return { isValid: false, event: validation.errorEvent };
                const isValid = validation.allowed.includes(trimmedInput);
                return isValid
                    ? { isValid: true, event: validation.successEvent ?? 'ok', data: validation.saveAs ? { [validation.saveAs]: trimmedInput } : undefined }
                    : { isValid: false, event: validation.errorEvent };

            case 'regex':
                if (!validation.pattern) return { isValid: false, event: validation.errorEvent };
                const matches = trimmedInput.match(new RegExp(validation.pattern));
                return matches
                    ? { isValid: true, event: validation.successEvent ?? 'ok', data: validation.saveAs ? { [validation.saveAs]: trimmedInput } : undefined }
                    : { isValid: false, event: validation.errorEvent };

            default:
                return { isValid: false, event: validation.errorEvent };
        }
    }

    async handle(ctx: any, currentState: string): Promise<void> {
        const { botId, chatId, userId, text } = ctx;
        const chatIdStr = String(chatId);
        const userIdStr = String(userId ?? chatId);

        const schema = await this.fsm.loadSchema(this.tenantId);
        const executor = this.createExecutor(schema, botId, chatIdStr, userIdStr, text?.trim() || '', currentState);

        let event: string;
        let data: Record<string, any> | undefined;

        if (ctx.isSystemEvent && ctx.event) {
            event = ctx.event;
        } else {
            const stateDef = await this.getStateDef(schema, currentState);
            const custom = this.determineEventForCustomState(currentState, text?.trim() || '');
            if (custom) {
                event = custom.event;
                data = custom.data;
            } else if (stateDef?.validation) {
                const result = this.validateInput(text?.trim() || '', stateDef.validation);
                event = result.event;
                data = result.data;
            } else {
                event = 'message';
            }
        }

        if (data) {
            await this.fsm.mergeData(this.tenantId, userIdStr, data, botId);
        }

        const result = await this.fsm.transition(this.tenantId, userIdStr, event, botId);

        if (result.actions?.length) {
            await executor.execute(result.actions);
        }

        if (result.to) {
            const entryActions = this.fsm.getEntryActions(this.tenantId, result.to);
            if (entryActions?.length) {
                await executor.execute(entryActions);
            }
        }
    }
}
