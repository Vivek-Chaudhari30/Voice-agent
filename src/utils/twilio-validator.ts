import crypto from 'crypto';
import { Request } from 'express';
import { env } from './env';
import logger from './logger';

/**
 * Validates Twilio webhook request signatures.
 * See: https://www.twilio.com/docs/usage/security#validating-requests
 */
export function validateTwilioSignature(req: Request): boolean {
  if (!env.ENABLE_WEBHOOK_VALIDATION) {
    return true;
  }

  const signature = req.headers['x-twilio-signature'] as string | undefined;
  if (!signature) {
    logger.warn('Missing x-twilio-signature header');
    return false;
  }

  const protocol = req.headers['x-forwarded-proto'] || req.protocol;
  const host = req.headers['x-forwarded-host'] || req.headers.host;
  const url = `${protocol}://${host}${req.originalUrl}`;

  // Build data string: URL + sorted POST params
  const params = req.body || {};
  const data = Object.keys(params)
    .sort()
    .reduce((acc, key) => acc + key + params[key], url);

  const expectedSignature = crypto
    .createHmac('sha1', env.TWILIO_AUTH_TOKEN)
    .update(Buffer.from(data, 'utf-8'))
    .digest('base64');

  const valid = signature === expectedSignature;
  if (!valid) {
    logger.warn({ url, signature }, 'Invalid Twilio signature');
  }
  return valid;
}
