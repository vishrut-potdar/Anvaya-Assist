import { Queue } from 'bullmq';
import { redis } from './redis.js';

export const eventQueue = new Queue('events', { connection: redis });
