import { Orchestrator } from "../../../newManagers/orchestrator/Orchestrator";
import { FSMManager } from '../../managers/FSMManager';
import { TenantSchema, StateDef } from '../../types';
import { HandlerContext } from './types';
import { ActionExecutor } from './ActionExecutor';

export abstract class BaseHandler {
    protected fsm: FSMManager;
    protected orchestrator: Orchestrator;
    protected tenantId: string = 'children';
    protected apiManager: any; // Теперь не null, а приходит из конструктора
    protected taskManager: any = null;

    // Принимаем apiManager в конструкторе
    constructor(orchestrator: Orchestrator, fsm: FSMManager, apiManager?: any) {
        this.orchestrator = orchestrator;
        this.fsm = fsm;
        this.apiManager = apiManager; // Сохраняем переданный apiManager
        this.taskManager = (orchestrator as any).engine?.getTaskManager?.();
    }

    // Убираем getManagers() - используем this.apiManager напрямую
    // Если нужно лениво инициализировать - делаем геттер
    protected getApiManager() {
        if (!this.apiManager) {
            // Fallback для обратной совместимости
            this.apiManager = this.orchestrator.getApiManagerForBot('test-adapter-bot');
        }
        return this.apiManager;
    }

    abstract canHandle(currentState: string): boolean;
    abstract handle(ctx: any, currentState: string): Promise<void>;

    protected async getStateDef(schema: TenantSchema, state: string): Promise<StateDef | undefined> {
        for (const flow of Object.values(schema.flows || {})) {
            if (flow.states?.[state]) {
                return flow.states[state];
            }
        }
        return undefined;
    }

    protected createExecutor(
        schema: TenantSchema,
        botId: string,
        chatId: string,
        userId: string,
        input: string,
        currentState: string
    ): ActionExecutor {
        return new ActionExecutor(
            this.orchestrator,
            this.fsm,
            schema,
            botId,
            chatId,
            userId,
            input,
            this.tenantId,
            currentState,
            this.apiManager
        );
    }
}