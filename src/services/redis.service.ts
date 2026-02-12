import Redis from 'ioredis';
import { config } from '../config/environment';
import { logger } from '../utils/logger.util';
import { TranscriptEntry, ActiveCall, CallHistory } from '../types';

let redis: Redis | null = null;

export async function initializeRedis(): Promise<void> {
  redis = new Redis(config.redis.url, {
    password: config.redis.password || undefined,
    maxRetriesPerRequest: 3,
    retryStrategy(times) {
      if (times > 5) {
        logger.error('Redis: max retries reached, giving up');
        return null;
      }
      return Math.min(times * 200, 2000);
    },
  });

  redis.on('connect', () => logger.info('Redis connected'));
  redis.on('error', (err) => logger.error('Redis error', { error: err.message }));

  // Test connection
  await redis.ping();
  logger.info('Redis ping successful');
}

export function getRedis(): Redis {
  if (!redis) throw new Error('Redis not initialized');
  return redis;
}

// ── Active Call Management ───────────────────────────────────────────────────

export async function setActiveCall(callSid: string, data: ActiveCall): Promise<void> {
  const r = getRedis();
  await r.setex(`active_call:${callSid}`, 3600, JSON.stringify(data));
}

export async function getActiveCall(callSid: string): Promise<ActiveCall | null> {
  const r = getRedis();
  const raw = await r.get(`active_call:${callSid}`);
  return raw ? JSON.parse(raw) : null;
}

export async function updateCallStatus(
  callSid: string,
  updates: Partial<ActiveCall>
): Promise<void> {
  const existing = await getActiveCall(callSid);
  if (existing) {
    await setActiveCall(callSid, { ...existing, ...updates, lastActivity: new Date().toISOString() });
  }
}

export async function removeActiveCall(callSid: string): Promise<void> {
  const r = getRedis();
  await r.del(`active_call:${callSid}`);
}

export async function getAllActiveCalls(): Promise<ActiveCall[]> {
  const r = getRedis();
  const keys = await r.keys('active_call:*');
  if (keys.length === 0) return [];

  const pipeline = r.pipeline();
  keys.forEach((k) => pipeline.get(k));
  const results = await pipeline.exec();

  const calls: ActiveCall[] = [];
  if (results) {
    for (const [err, raw] of results) {
      if (!err && raw) {
        try {
          calls.push(JSON.parse(raw as string));
        } catch { /* skip corrupt entries */ }
      }
    }
  }
  return calls;
}

// ── Transcript Management ────────────────────────────────────────────────────

export async function saveTranscript(callSid: string, entry: TranscriptEntry): Promise<void> {
  const r = getRedis();
  const key = `transcript:${callSid}`;
  await r.rpush(key, JSON.stringify(entry));
  await r.expire(key, 86400); // 24-hour retention
}

export async function getTranscript(callSid: string): Promise<TranscriptEntry[]> {
  const r = getRedis();
  const entries = await r.lrange(`transcript:${callSid}`, 0, -1);
  return entries.map((e) => JSON.parse(e));
}

// ── Call History ─────────────────────────────────────────────────────────────

export async function addCallHistory(data: CallHistory): Promise<void> {
  const r = getRedis();
  await r.zadd('call_history', Date.now(), JSON.stringify(data));
  // Keep last 500 entries
  await r.zremrangebyrank('call_history', 0, -501);
}

export async function getCallHistory(limit = 20): Promise<CallHistory[]> {
  const r = getRedis();
  const entries = await r.zrevrange('call_history', 0, limit - 1);
  return entries.map((e) => JSON.parse(e));
}

// ── Metrics ──────────────────────────────────────────────────────────────────

export async function trackMetric(name: string, value: number): Promise<void> {
  const r = getRedis();
  const key = `metrics:${name}`;
  await r.lpush(key, value.toString());
  await r.ltrim(key, 0, 99);
}

export async function getMetricValues(name: string): Promise<number[]> {
  const r = getRedis();
  const values = await r.lrange(`metrics:${name}`, 0, -1);
  return values.map(Number);
}

export async function incrementCounter(name: string): Promise<void> {
  const r = getRedis();
  await r.incr(`counter:${name}`);
}

export async function getCounter(name: string): Promise<number> {
  const r = getRedis();
  const val = await r.get(`counter:${name}`);
  return val ? parseInt(val, 10) : 0;
}
