import express from 'express';
import { createServer } from 'http';
import { validateEnv, env } from './utils/env';
import logger from './utils/logger';
import { validateTwilioSignature } from './utils/twilio-validator';
import { initRedis } from './session-manager';
import { initDatabase } from './tools/database';
import { createWebSocketServer } from './websocket-server';

// ── Bootstrap ──────────────────────────────────────────────────────────────

validateEnv();

const app = express();
app.use(express.urlencoded({ extended: false })); // Twilio sends form-encoded
app.use(express.json());

// ── Health check ───────────────────────────────────────────────────────────

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', uptime: process.uptime() });
});

// ── Twilio Voice webhook ───────────────────────────────────────────────────

app.post('/voice', (req, res) => {
  // Validate Twilio signature
  if (env.ENABLE_WEBHOOK_VALIDATION && !validateTwilioSignature(req)) {
    logger.warn('Rejected request with invalid Twilio signature');
    res.status(403).send('Invalid signature');
    return;
  }

  const callSid = req.body.CallSid || 'unknown';
  const from = req.body.From || 'unknown';
  logger.info({ callSid, from }, 'Incoming call');

  // Build the public WebSocket URL for Twilio to connect to
  const publicUrl = env.PUBLIC_URL.replace(/^https?:\/\//, '');
  const wsProtocol = env.PUBLIC_URL.startsWith('https') ? 'wss' : 'ws';
  const streamUrl = `${wsProtocol}://${publicUrl}/media-stream`;

  // Respond with TwiML that starts a bidirectional media stream
  const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Connect>
    <Stream url="${streamUrl}">
      <Parameter name="from" value="${from}" />
    </Stream>
  </Connect>
</Response>`;

  res.type('text/xml').send(twiml);
  logger.info({ callSid, streamUrl }, 'TwiML response sent');
});

// ── Start server ───────────────────────────────────────────────────────────

async function start(): Promise<void> {
  // Initialise dependencies
  initRedis();
  initDatabase();

  const httpServer = createServer(app);

  // Attach WebSocket server for Twilio media streams
  createWebSocketServer(httpServer);

  httpServer.listen(env.PORT, () => {
    logger.info(`Server running on http://localhost:${env.PORT}`);
    logger.info(`WebSocket endpoint: ws://localhost:${env.PORT}/media-stream`);
    logger.info(`Public URL: ${env.PUBLIC_URL}`);
    logger.info(`Webhook URL: ${env.PUBLIC_URL}/voice`);
  });

  // Graceful shutdown
  const shutdown = (signal: string) => {
    logger.info({ signal }, 'Shutting down');
    httpServer.close(() => {
      logger.info('HTTP server closed');
      process.exit(0);
    });
    // Force exit after 10s
    setTimeout(() => process.exit(1), 10_000);
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

start().catch((err) => {
  logger.fatal({ err }, 'Failed to start server');
  process.exit(1);
});
