import { Redis } from 'ioredis';
import { getTaggedLogger } from '../../addons/logger';

const taskLog = getTaggedLogger('TaskManager');

/**
 * TaskManager - отвечает ТОЛЬКО за:
 * - постановку задач в очередь
 * - запуск воркеров
 * - НЕ содержит логику обработки задач
 */
export class TaskManager {
  private redis: Redis;
  private workers: Map<string, boolean> = new Map();

  constructor(redis: Redis) {
    this.redis = redis;
  }

  queueKey(tenantId: string) {
    return `engine:${tenantId}:tasks`;
  }

  /**
   * Поставить задачу в очередь
   */
  async enqueueTask(tenantId: string, task: Record<string, any>): Promise<void> {
    const key = this.queueKey(tenantId);
    await this.redis.lpush(key, JSON.stringify(task));
  }

  /**
   * Запустить воркер для tenant
   * @param handler - функция обработки задачи (передается извне)
   */
  startWorker(tenantId: string, handler: (task: any) => Promise<void>): void {
    if (this.workers.get(tenantId)) return;
    this.workers.set(tenantId, true);

    const key = this.queueKey(tenantId);

    const loop = async () => {
      while (this.workers.get(tenantId)) {
        try {
          const res = await this.redis.brpop(key, 5);
          if (!res) continue;

          const payload = res[1];
          let task = null;
          try {
            task = JSON.parse(payload);
          } catch (err) {
            taskLog.error('invalid task payload', { error: err });
            continue;
          }

          // Вызываем внешний обработчик, переданный при старте
          await handler(task);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          taskLog.error('worker error', { message: msg });
          await new Promise((r) => setTimeout(r, 1000));
        }
      }
    };

    void loop();
  }

  stopWorker(tenantId: string): void {
    this.workers.set(tenantId, false);
  }

  isWorkerRunning(tenantId: string): boolean {
    return this.workers.get(tenantId) || false;
  }
}