import Redis from 'ioredis';
import { EventEmitter } from 'node:events';
import { config } from './config.ts';

// In-memory fallback store with TTL and Pub/Sub
class InMemoryRedisFallback extends EventEmitter {
  private store = new Map<string, { value: string; expiresAt?: number }>();

  async get(key: string): Promise<string | null> {
    const item = this.store.get(key);
    if (!item) return null;
    if (item.expiresAt && Date.now() > item.expiresAt) {
      this.store.delete(key);
      return null;
    }
    return item.value;
  }

  async set(key: string, value: string, mode?: string, duration?: number): Promise<'OK'> {
    let expiresAt: number | undefined;
    if (mode === 'EX' && duration) {
      expiresAt = Date.now() + duration * 1000;
    } else if (mode === 'PX' && duration) {
      expiresAt = Date.now() + duration;
    }
    this.store.set(key, { value: String(value), expiresAt });
    return 'OK';
  }

  async del(key: string): Promise<number> {
    const existed = this.store.delete(key);
    return existed ? 1 : 0;
  }

  async incr(key: string): Promise<number> {
    const item = await this.get(key);
    const nextVal = (Number(item) || 0) + 1;
    this.store.set(key, { value: String(nextVal) });
    return nextVal;
  }

  async expire(key: string, seconds: number): Promise<number> {
    const item = this.store.get(key);
    if (!item) return 0;
    item.expiresAt = Date.now() + seconds * 1000;
    return 1;
  }

  async publish(channel: string, message: string): Promise<number> {
    this.emit(channel, message);
    return 1;
  }

  async subscribe(channel: string, listener: (msg: string) => void): Promise<void> {
    this.on(channel, listener);
  }

  status = 'in-memory-ready';
}

let redisClient: any;
let isRealRedis = false;

if (config.redisUrl) {
  try {
    const client = new Redis(config.redisUrl, {
      maxRetriesPerRequest: 1,
      connectTimeout: 2000,
      lazyConnect: true,
    });
    client.connect().then(() => {
      console.log('Connected to remote Redis instance at', config.redisUrl);
      isRealRedis = true;
    }).catch((err) => {
      console.warn('Could not connect to remote Redis, using built-in in-memory Redis engine:', err.message);
    });
    redisClient = client;
  } catch {
    redisClient = new InMemoryRedisFallback();
  }
} else {
  redisClient = new InMemoryRedisFallback();
}

export const redis = redisClient;
export const isRedisRemote = () => isRealRedis;
