import { Server as HttpServer } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import { IncomingMessage } from 'http';
import logger from './utils/logger';
import { TwilioStreamHandler } from './twilio-handler';

/**
 * Creates the WebSocket server that handles Twilio Media Stream connections.
 * Twilio connects to wss://<host>/media-stream after receiving TwiML <Stream>.
 */
export function createWebSocketServer(httpServer: HttpServer): WebSocketServer {
  const wss = new WebSocketServer({
    server: httpServer,
    path: '/media-stream',
  });

  wss.on('connection', (ws: WebSocket, req: IncomingMessage) => {
    logger.info(
      { remoteAddress: req.socket.remoteAddress, url: req.url },
      'New WebSocket connection on /media-stream',
    );

    // Each connection is one phone call — hand off to the stream handler
    new TwilioStreamHandler(ws);
  });

  wss.on('error', (err) => {
    logger.error({ err }, 'WebSocket server error');
  });

  logger.info('WebSocket server attached at /media-stream');
  return wss;
}
