import Redis from 'ioredis';
import { EngineConfig } from './types';
import { getTaggedLogger } from '../addons/logger';

const redisLog = getTaggedLogger('redis');

export function createRedisClient(config?: EngineConfig['redis']) {
  const host = config?.host ?? '127.0.0.1';
  const port = config?.port ?? 6379;
  const raw = config?.password;
  const password =
    raw != null && String(raw).trim() !== '' ? String(raw) : undefined;

  const opts: { host: string; port: number; password?: string } = { host, port };
  if (password !== undefined) opts.password = password;

  const client = new Redis(opts);
  client.on('error', (err) => {
    const msg = err instanceof Error ? err.message : String(err);
    redisLog.error('ioredis error', { message: msg });
  });
  return client;
}
