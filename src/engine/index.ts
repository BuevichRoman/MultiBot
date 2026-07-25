import path from 'path';
import type { Redis } from 'ioredis';
import { createRedisClient } from './redisClient';
import { FSMManager } from './managers/FSMManager';
import { TaskManager } from './managers/TaskManager';
import { EngineConfig } from './types';
import { getTaggedLogger } from '../addons/logger';

const engineLog = getTaggedLogger('Engine');

/**
 * Движок FSM: Redis + загрузка схем тенантов + фоновые задачи (`TaskManager`).
 * Параметры подключения к Redis задаются в `config/app.json` (прод) или в `EngineConfig`.
 */
export class Engine {
  private redis: Redis;
  private fsm: FSMManager;
  private task: TaskManager;
  private readonly flushRedisOnStartup: boolean;

  constructor(config?: EngineConfig) {
    const redisCfg = config?.redis ?? { host: '127.0.0.1', port: 6379 };
    this.redis = createRedisClient(redisCfg);
    const taskRedis = createRedisClient(redisCfg);
    const schemasPath = config?.schemasPath ?? path.join('src', 'engine', 'schemas');
    this.flushRedisOnStartup = config?.flushRedisOnStartup !== false;
    this.fsm = new FSMManager(this.redis, schemasPath);
    this.task = new TaskManager(taskRedis);
  }

  /**
   * Очистить текущую логическую БД Redis (FLUSHDB): ключи FSM и очередей задач.
   * Вызывать один раз при холодном старте процесса, до обработки сообщений.
   */
  async flushRedisOnColdStart(): Promise<void> {
    if (!this.flushRedisOnStartup) {
      engineLog.info('Redis FLUSHDB пропущен (engine.flushRedisOnStartup === false)');
      return;
    }
    await this.redis.flushdb();
    engineLog.warn(
      'Redis FLUSHDB выполнен при старте: сброшены состояния FSM и очереди задач в текущей БД',
    );
  }

  getFSMManager() {
    return this.fsm;
  }

  getTaskManager() {
    return this.task;
  }

  async loadTenantSchema(tenantId: string) {
    return this.fsm.loadSchema(tenantId);
  }

  /** Reset chat across loaded tenant schemas (userId — ключ для state/data; botId — сегмент в Redis при мультиботе) */
  async resetChat(userId: string, botId?: string) {
    return this.fsm.resetChatToInitial(userId, botId);
  }
}

export default Engine;
