import { Request, Response } from 'express';
import twilio from 'twilio';
import { config } from '../config/environment';
import { logger } from '../utils/logger.util';

const { VoiceResponse } = twilio.twiml;

export default function voiceHandler(req: Request, res: Response): void {
  const callSid = req.body.CallSid as string;
  const from = req.body.From as string;

  // ── Webhook signature verification ──────────────────────────────────────
  if (config.features.enableWebhookValidation && config.server.nodeEnv === 'production') {
    const twilioSignature = req.headers['x-twilio-signature'] as string;
    const url = `${config.server.publicUrl}/voice`;

    const valid = twilio.validateRequest(
      config.twilio.authToken,
      twilioSignature,
      url,
      req.body
    );

    if (!valid) {
      logger.warn('Invalid Twilio signature', { callSid, url });
      res.status(403).send('Forbidden');
      return;
    }
  }

  logger.info('Incoming call', { callSid, from });

  // ── Generate TwiML with Media Stream ────────────────────────────────────
  const twiml = new VoiceResponse();

  const connect = twiml.connect();
  const stream = connect.stream({
    url: `wss://${req.headers.host}/media-stream`,
  });

  // Pass call metadata to the WebSocket handler
  stream.parameter({ name: 'callSid', value: callSid });
  stream.parameter({ name: 'callerNumber', value: from });

  res.type('text/xml');
  res.send(twiml.toString());
}
