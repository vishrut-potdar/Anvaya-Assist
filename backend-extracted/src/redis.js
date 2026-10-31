import Redis from 'ioredis';
import { config } from './config.js';

// maxRetriesPerRequest: null is required by BullMQ
export const redis = new Redis(config.redisUrl, { maxRetriesPerRequest: null });
