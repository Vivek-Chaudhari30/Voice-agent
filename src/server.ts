import express from 'express';
import http from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import { logger } from './utils/logger.util';
import { config } from './config/environment';
import { initializeRedis } from './services/redis.service';
import { initializeDatabase } from './services/database.service';
import voiceHandler from './handlers/voice.handler';
import mediaStreamHandler from './handlers/media-stream.handler';
import dashboardRoutes from './dashboard/routes';
import simulatorRoutes from './simulator/routes';

const app = express();
const server = http.createServer(app);

// ── Middleware ─────────────────────────────────────────────────────────────
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ── Health check ──────────────────────────────────────────────────────────
app.get('/health', (_req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
  });
});

// ── Twilio voice webhook ──────────────────────────────────────────────────
app.post('/voice', voiceHandler);

// ── Dashboard ─────────────────────────────────────────────────────────────
app.use('/dashboard', dashboardRoutes);

// ── Phone Simulator (local testing without Twilio) ────────────────────────
app.use('/simulator', simulatorRoutes);

// ── WebSocket server for Twilio Media Streams ─────────────────────────────
const wss = new WebSocketServer({ server, path: '/media-stream' });

wss.on('connection', (ws: WebSocket, req) => {
  logger.info('New WebSocket connection', { url: req.url });
  mediaStreamHandler(ws, req);
});

// ── Bootstrap ─────────────────────────────────────────────────────────────
async function bootstrap(): Promise<void> {
  try {
    await initializeRedis();
    logger.info('Redis initialized');

    await initializeDatabase();
    logger.info('Database initialized');

    server.listen(config.server.port, () => {
      logger.info(`Server running on port ${config.server.port}`);
      logger.info(`Twilio webhook:  ${config.server.publicUrl}/voice`);
      logger.info(`Dashboard:       http://localhost:${config.server.port}/dashboard`);
      logger.info(`Health check:    http://localhost:${config.server.port}/health`);
      logger.info(`Phone Simulator: http://localhost:${config.server.port}/simulator`);
    });
  } catch (err) {
    logger.error('Failed to start server', { error: (err as Error).message });
    process.exit(1);
  }
}

// ── Graceful shutdown ─────────────────────────────────────────────────────
function shutdown(signal: string): void {
  logger.info(`Received ${signal}, shutting down gracefully`);

  wss.clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      client.close(1001, 'Server shutting down');
    }
  });

  server.close(() => {
    logger.info('HTTP server closed');
    process.exit(0);
  });

  // Force exit after 10 s
  setTimeout(() => {
    logger.error('Forced shutdown');
    process.exit(1);
  }, 10_000);
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

bootstrap();
