import type { Redis } from 'ioredis';
import type { OrderWatchEntry, OrderWatchStore } from './types';

/**
 * Наблюдаемые заказы тенанта в хеше Redis: поле — orderId, значение — запись
 * целиком. Задача watch_order из очереди забирается один раз, поэтому без
 * этого после рестарта бот переставал следить за уже идущими заказами.
 */
export function redisWatchStore(redis: Redis, tenantId: string): OrderWatchStore {
  const key = `ordermgr:${tenantId}:watches`;
  return {
    async load() {
      const all = await redis.hgetall(key);
      const entries: OrderWatchEntry[] = [];
      for (const raw of Object.values(all)) {
        try {
          entries.push(JSON.parse(raw));
        } catch {
          /* битую запись пропускаем */
        }
      }
      return entries;
    },
    async save(entry) {
      await redis.hset(key, entry.orderId, JSON.stringify(entry));
    },
    async remove(orderId) {
      await redis.hdel(key, orderId);
    },
  };
}
