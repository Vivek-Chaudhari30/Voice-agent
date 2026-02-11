import Redis from 'ioredis';
import { env } from './utils/env';
import logger from './utils/logger';
import type { CallSession, TranscriptEntry, ToolCallLog } from './types/session';

let redis: Redis;

export function initRedis(): Redis {
  redis = new Redis(env.REDIS_URL, {
    password: env.REDIS_PASSWORD || undefined,
    maxRetriesPerRequest: 3,
    retryStrategy(times) {
      if (times > 5) return null; // stop retrying
      return Math.min(times * 200, 2000);
    },
  });

  redis.on('connect', () => logger.info('Redis connected'));
  redis.on('error', (err) => logger.error({ err }, 'Redis error'));

  return redis;
}

export function getRedis(): Redis {
  if (!redis) throw new Error('Redis not initialised. Call initRedis() first.');
  return redis;
}

const SESSION_TTL = 600; // 10 minutes
const keyFor = (callSid: string) => `session:${callSid}`;

// ── CRUD ───────────────────────────────────────────────────────────────────

export async function createSession(
  callSid: string,
  streamSid: string,
  phoneNumber: string,
): Promise<CallSession> {
  const session: CallSession = {
    callSid,
    streamSid,
    phoneNumber,
    startTime: Date.now(),
    transcript: [],
    toolCalls: [],
    openaiSessionId: null,
    status: 'active',
    audioStats: {
      chunksReceived: 0,
      chunksSent: 0,
      totalBytesReceived: 0,
      totalBytesSent: 0,
    },
  };

  await redis.setex(keyFor(callSid), SESSION_TTL, JSON.stringify(session));
  logger.info({ callSid, streamSid }, 'Session created');
  return session;
}

export async function getSession(callSid: string): Promise<CallSession | null> {
  const data = await redis.get(keyFor(callSid));
  return data ? (JSON.parse(data) as CallSession) : null;
}

export async function updateSession(session: CallSession): Promise<void> {
  await redis.setex(keyFor(session.callSid), SESSION_TTL, JSON.stringify(session));
}

export async function endSession(callSid: string, reason: string): Promise<void> {
  const session = await getSession(callSid);
  if (!session) return;

  session.status = 'ended';
  // Keep for 30 min after ending so transcripts can be retrieved
  await redis.setex(keyFor(callSid), 1800, JSON.stringify(session));
  logger.info({ callSid, reason, duration: Date.now() - session.startTime }, 'Session ended');
}

// ── Helpers ────────────────────────────────────────────────────────────────

export async function appendTranscript(
  callSid: string,
  entry: TranscriptEntry,
): Promise<void> {
  const session = await getSession(callSid);
  if (!session) return;
  session.transcript.push(entry);
  await updateSession(session);
}

export async function appendToolCall(
  callSid: string,
  log: ToolCallLog,
): Promise<void> {
  const session = await getSession(callSid);
  if (!session) return;
  session.toolCalls.push(log);
  await updateSession(session);
}

export async function updateAudioStats(
  callSid: string,
  direction: 'received' | 'sent',
  bytes: number,
): Promise<void> {
  const session = await getSession(callSid);
  if (!session) return;

  if (direction === 'received') {
    session.audioStats.chunksReceived++;
    session.audioStats.totalBytesReceived += bytes;
  } else {
    session.audioStats.chunksSent++;
    session.audioStats.totalBytesSent += bytes;
  }

  await updateSession(session);
}

export async function setOpenAISessionId(
  callSid: string,
  openaiSessionId: string,
): Promise<void> {
  const session = await getSession(callSid);
  if (!session) return;
  session.openaiSessionId = openaiSessionId;
  await updateSession(session);
}
