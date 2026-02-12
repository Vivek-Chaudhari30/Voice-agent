import dotenv from 'dotenv';
import { logger } from '../utils/logger.util';

dotenv.config();

export interface AppConfig {
  twilio: {
    accountSid: string;
    authToken: string;
    phoneNumber: string;
  };
  openai: {
    apiKey: string;
    realtimeModel: string;
    voice: string;
  };
  server: {
    port: number;
    nodeEnv: string;
    publicUrl: string;
  };
  redis: {
    url: string;
    password: string;
  };
  logging: {
    level: string;
  };
  features: {
    enableWebhookValidation: boolean;
    maxCallDurationMinutes: number;
  };
}

function requireEnv(key: string): string {
  const value = process.env[key];
  if (!value) {
    logger.error(`Missing required environment variable: ${key}`);
    throw new Error(`Missing required environment variable: ${key}`);
  }
  return value;
}

export function loadConfig(): AppConfig {
  return {
    twilio: {
      accountSid: requireEnv('TWILIO_ACCOUNT_SID'),
      authToken: requireEnv('TWILIO_AUTH_TOKEN'),
      phoneNumber: requireEnv('TWILIO_PHONE_NUMBER'),
    },
    openai: {
      apiKey: requireEnv('OPENAI_API_KEY'),
      realtimeModel: process.env.OPENAI_REALTIME_MODEL || 'gpt-4o-realtime-preview-2024-10-01',
      voice: process.env.OPENAI_VOICE || 'alloy',
    },
    server: {
      port: parseInt(process.env.PORT || '3000', 10),
      nodeEnv: process.env.NODE_ENV || 'development',
      publicUrl: requireEnv('PUBLIC_URL'),
    },
    redis: {
      url: process.env.REDIS_URL || 'redis://localhost:6379',
      password: process.env.REDIS_PASSWORD || '',
    },
    logging: {
      level: process.env.LOG_LEVEL || 'info',
    },
    features: {
      enableWebhookValidation: process.env.ENABLE_WEBHOOK_VALIDATION === 'true',
      maxCallDurationMinutes: parseInt(process.env.MAX_CALL_DURATION_MINUTES || '5', 10),
    },
  };
}

export const config = loadConfig();
