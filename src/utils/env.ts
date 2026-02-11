import dotenv from 'dotenv';
import logger from './logger';

dotenv.config();

const REQUIRED_VARS = [
  'TWILIO_ACCOUNT_SID',
  'TWILIO_AUTH_TOKEN',
  'OPENAI_API_KEY',
  'REDIS_URL',
  'PORT',
  'PUBLIC_URL',
] as const;

export function validateEnv(): void {
  const missing: string[] = [];
  for (const varName of REQUIRED_VARS) {
    if (!process.env[varName]) {
      missing.push(varName);
    }
  }
  if (missing.length > 0) {
    logger.fatal({ missing }, 'Missing required environment variables');
    throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
  }
}

export const env = {
  get TWILIO_ACCOUNT_SID(): string { return process.env.TWILIO_ACCOUNT_SID!; },
  get TWILIO_AUTH_TOKEN(): string { return process.env.TWILIO_AUTH_TOKEN!; },
  get TWILIO_PHONE_NUMBER(): string { return process.env.TWILIO_PHONE_NUMBER || ''; },
  get OPENAI_API_KEY(): string { return process.env.OPENAI_API_KEY!; },
  get OPENAI_REALTIME_MODEL(): string { return process.env.OPENAI_REALTIME_MODEL || 'gpt-4o-realtime-preview-2024-10-01'; },
  get PORT(): number { return parseInt(process.env.PORT || '3000', 10); },
  get PUBLIC_URL(): string { return process.env.PUBLIC_URL!; },
  get REDIS_URL(): string { return process.env.REDIS_URL!; },
  get REDIS_PASSWORD(): string { return process.env.REDIS_PASSWORD || ''; },
  get NODE_ENV(): string { return process.env.NODE_ENV || 'development'; },
  get ENABLE_WEBHOOK_VALIDATION(): boolean { return process.env.ENABLE_WEBHOOK_VALIDATION !== 'false'; },
  get MAX_CALL_DURATION_MINUTES(): number { return parseInt(process.env.MAX_CALL_DURATION_MINUTES || '5', 10); },
};
