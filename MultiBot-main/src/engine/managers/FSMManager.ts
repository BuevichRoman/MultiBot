import fs from 'fs/promises';
import path from 'path';
import { Redis } from 'ioredis';
import { getTaggedLogger } from '../../addons/logger';

const fsmLog = getTaggedLogger('FSM');
import { TenantSchema, Flow, Action, State, Transition } from '../types';

/**
 * FSMManager - отвечает ТОЛЬКО за:
 * - загрузку схем
 * - хранение состояний в Redis
 * - переходы между состояниями
 * - НЕ выполняет действия, НЕ валидирует ввод
 */
export class FSMManager {
  private redis: Redis;
  private schemasPath: string;
  private schemas: Map<string, TenantSchema> = new Map();

  constructor(redis: Redis, schemasPath?: string) {
    this.redis = redis;
    this.schemasPath = schemasPath || path.join('src', 'engine', 'schemas');
  }

  // ==================== ЗАГРУЗКА СХЕМ ====================

  async loadSchema(tenantId: string): Promise<TenantSchema> {
    if (this.schemas.has(tenantId)) {
      return this.schemas.get(tenantId)!;
    }

    try {
      const schema = await this.loadSchemaFromFolder(tenantId);
      this.schemas.set(tenantId, schema);
      return schema;
    } catch (folderError) {
      try {
        const schema = await this.loadSchemaFromFile(tenantId);
        this.schemas.set(tenantId, schema);
        return schema;
      } catch (fileError) {
        throw new Error(`Failed to load schema for tenant ${tenantId}: ${fileError}`);
      }
    }
  }

  private async loadSchemaFromFolder(tenantId: string): Promise<TenantSchema> {
    const tenantPath = path.join(this.schemasPath, tenantId);

    await fs.access(tenantPath);

    const initPath = path.join(tenantPath, '_init.json');
    const initContent = await fs.readFile(initPath, 'utf8');
    const initSchema = JSON.parse(initContent);

    const files = await fs.readdir(tenantPath);
    const flowFiles = files.filter(f => f.endsWith('.json') && f !== '_init.json');

    const flows: Record<string, Flow> = {};
    const allActions: Record<string, Action> = { ...(initSchema.actions || {}) };

    for (const file of flowFiles) {
      const content = await fs.readFile(path.join(tenantPath, file), 'utf8');
      const flowData = JSON.parse(content);

      // ✅ ВАЖНО: Теперь сохраняем validation!
      const prefixedStates: Record<string, State> = {};
      for (const [stateName, stateData] of Object.entries(flowData.states || {})) {
        const state = stateData as any;
        prefixedStates[`${flowData.name}.${stateName}`] = {
          id: `${flowData.name}.${stateName}`,
          entryActions: state.entryActions || [],
          transitions: (state.transitions || []).map((t: any) => ({
            event: t.event,
            to: t.to,
            actions: t.actions || []
          })),
          // ✅ Добавляем validation, если он есть
          ...(state.validation && { validation: state.validation }),
          ...(state.actions && { actions: state.actions}), // state specific action(NOT GLOBAL)
          ...(state.location && { location: state.location })
        };
      }

      // Merge actions from flow
      const flowActions = flowData.actions || {};
      Object.assign(allActions, flowActions);

      flows[flowData.name] = {
        name: flowData.name,
        description: flowData.description,
        states: prefixedStates,
        actions: flowActions
      };
    }

    this.resolveFlowLinks(flows);

    return {
      initialState: initSchema.initialState,
      actions: allActions,
      flowSelection: initSchema.flowSelection || {
        strategy: 'first_match',
        flows: [{ name: 'registration', condition: '!user.registered', default: true }]
      },
      flows
    };
  }

  private async loadSchemaFromFile(tenantId: string): Promise<TenantSchema> {
    const filePath = path.resolve(this.schemasPath, `${tenantId}.json`);
    const content = await fs.readFile(filePath, 'utf8');
    return JSON.parse(content) as TenantSchema;
  }

  private resolveFlowLinks(flows: Record<string, Flow>): void {
    for (const flow of Object.values(flows)) {
      for (const state of Object.values(flow.states)) {
        for (const transition of state.transitions) {
          if (transition.to && transition.to.startsWith('{{link:')) {
            const match = transition.to.match(/{{link:([^#]+)#([^}]+)}}/);
            if (match) {
              const [_, flowName, stateName] = match;
              transition.to = `${flowName}.${stateName}`;
            }
          }
        }
      }
    }
  }

  getSchema(tenantId: string): TenantSchema | undefined {
    return this.schemas.get(tenantId);
  }

  // ==================== УПРАВЛЕНИЕ СОСТОЯНИЯМИ ====================

  /**
   * Ключи Redis:
   * - с botId: `engine:{tenant}:{botId}:state:{userId}` — разные боты (TG/WA) не делят FSM при совпадении userId;
   * - без botId: прежний формат `engine:{tenant}:state:{userId}` (обратная совместимость).
   */
  private stateKey(tenantId: string, userId: string, botId?: string) {
    if (botId != null && botId !== '') {
      return `engine:${tenantId}:${botId}:state:${userId}`;
    }
    return `engine:${tenantId}:state:${userId}`;
  }

  private dataKey(tenantId: string, userId: string, botId?: string) {
    if (botId != null && botId !== '') {
      return `engine:${tenantId}:${botId}:stateData:${userId}`;
    }
    return `engine:${tenantId}:stateData:${userId}`;
  }

  async getState(tenantId: string, userId: string, botId?: string): Promise<string | null> {
    const key = this.stateKey(tenantId, userId, botId);
    return this.redis.get(key);
  }

  async setState(tenantId: string, userId: string, stateId: string, botId?: string): Promise<void> {
    const key = this.stateKey(tenantId, userId, botId);
    await this.redis.set(key, stateId);
  }

  async getData(tenantId: string, userId: string, botId?: string): Promise<any> {
    const key = this.dataKey(tenantId, userId, botId);
    const raw = await this.redis.get(key);
    if (!raw) return {};
    try {
      return JSON.parse(raw);
    } catch (e) {
      return {};
    }
  }

  async setData(tenantId: string, userId: string, data: any, botId?: string): Promise<void> {
    const key = this.dataKey(tenantId, userId, botId);
    await this.redis.set(key, JSON.stringify(data || {}));
  }

  /** Полное сбросить состояние и данные пользователя (например после удаления аккаунта). Следующее сообщение пройдёт determineFlow заново. */
  async clearUserStateAndData(tenantId: string, userId: string, botId?: string): Promise<void> {
    await this.redis.del(this.stateKey(tenantId, userId, botId), this.dataKey(tenantId, userId, botId));
  }

  async mergeData(tenantId: string, userId: string, patch: Record<string, any>, botId?: string): Promise<void> {
    const cur = await this.getData(tenantId, userId, botId);
    const merged = this.deepMerge(cur || {}, patch || {});
    await this.setData(tenantId, userId, merged, botId);
  }

  private deepMerge(target: Record<string, any>, source: Record<string, any>): Record<string, any> {
    const result = { ...target };
    for (const key of Object.keys(source)) {
      if (key.includes('.')) {
        const keys = key.split('.');
        let obj: any = result;
        for (let i = 0; i < keys.length - 1; i++) {
          const k = keys[i];
          if (!obj[k] || typeof obj[k] !== 'object') obj[k] = {};
          obj = obj[k];
        }
        obj[keys[keys.length - 1]] = source[key];
      } else if (source[key] && typeof source[key] === 'object' && !Array.isArray(source[key]) && target[key] && typeof target[key] === 'object') {
        result[key] = this.deepMerge(target[key], source[key]);
      } else {
        result[key] = source[key];
      }
    }
    return result;
  }

  async resetChatToInitial(userId: string, botId?: string): Promise<void> {
    for (const [tenantId, schema] of this.schemas.entries()) {
      try {
        await this.setState(tenantId, userId, schema.initialState, botId);
        await this.setData(tenantId, userId, {}, botId);
      } catch (e) {
        // ignore
      }
    }
  }

  // ==================== ПЕРЕХОДЫ (ТОЛЬКО ВОЗВРАЩАЮТ ИМЕНА ДЕЙСТВИЙ) ====================

  /**
   * Выполняет переход между состояниями
   * @returns ТОЛЬКО информацию о переходе и ИМЕНА действий, НЕ выполняет их
   */
  async transition(tenantId: string, userId: string, event: string, botId?: string): Promise<{
    from: string | null;
    to: string | null;
    actions: string[];
  }> {
    let log = '';

    const addLog = (message: string) => {
      log += message + '\n';
    };

    const schema = await this.loadSchema(tenantId);
    const current = (await this.getState(tenantId, userId, botId)) ?? schema.initialState;

    addLog('🔍 TRANSITION DEBUG:');
    addLog(`  - looking for state: ${current}`);
    addLog(`  - event: ${event}`);

    // Найти состояние во всех потоках
    let stateDef: State | null = null;
    let foundFlow = null;

    for (const [flowName, flow] of Object.entries(schema.flows || {})) {
      addLog(`  - checking flow: ${flowName}, states: ${JSON.stringify(Object.keys(flow.states || {}))}`);

      if (flow.states?.[current]) {
        stateDef = flow.states[current];
        foundFlow = flowName;
        addLog(`  ✅ Found state in flow: ${flowName}`);
        break;
      }
    }

    if (!stateDef) {
      addLog('  ❌ State not found in any flow!');
      const allStates = Object.values(schema.flows || {}).flatMap(f => Object.keys(f.states || {}));
      addLog(`  - all states: ${JSON.stringify(allStates)}`);

      if (process.env.FSM_TRANSITION_DEBUG === '1') {
        fsmLog.debug('transition log (state not found)', { log });
      }

      return { from: current, to: null, actions: [] };
    }

    addLog(`  - available transitions: ${JSON.stringify(stateDef.transitions.map(t => t.event))}`);

    const transition = (stateDef.transitions || []).find((t) => t.event === event);
    if (!transition) {
      addLog(`  ❌ Transition not found for event: ${event}`);

      if (process.env.FSM_TRANSITION_DEBUG === '1') {
        fsmLog.debug('transition log (transition not found)', { log });
      }

      return { from: current, to: null, actions: [] };
    }

    addLog(`  ✅ Found transition to: ${transition.to}`);

    const to = transition.to;
    await this.setState(tenantId, userId, to, botId);

    // Выводим весь накопленный лог перед возвратом результата
    //console.log('\n📋 TRANSITION LOG:\n' + log);

    return {
      from: current,
      to,
      actions: transition.actions || []
    };
  }

  /**
   * Получить действия для входа в состояние
   */
  getEntryActions(tenantId: string, stateId: string): string[] {
    const schema = this.schemas.get(tenantId);
    if (!schema) return [];

    for (const flow of Object.values(schema.flows || {})) {
      if (flow.states?.[stateId]) {
        return flow.states[stateId].entryActions || [];
      }
    }
    return [];
  }

  getActions(tenantId: string): Record<string, Action> {
    const schema = this.schemas.get(tenantId);
    return schema?.actions || {};
  }

  getFlowSelection(tenantId: string): any {
    const schema = this.schemas.get(tenantId);
    return schema?.flowSelection;
  }
}