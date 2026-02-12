import { Router, Request, Response } from 'express';
import path from 'path';
import express from 'express';
import callsApi from './api/calls.api';
import metricsApi from './api/metrics.api';
import transcriptsApi from './api/transcripts.api';
import { getAllActiveCalls, getCallHistory } from '../services/redis.service';
import { getMetricValues } from '../services/redis.service';

const router = Router();

// Serve static files
router.use(express.static(path.join(__dirname, 'public')));

// API routes
router.use('/api/calls', callsApi);
router.use('/api/metrics', metricsApi);
router.use('/api/transcripts', transcriptsApi);

// SSE stream for dashboard real-time updates
router.get('/stream', (req: Request, res: Response) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  const sendUpdates = async () => {
    try {
      const activeCalls = await getAllActiveCalls();
      res.write(`event: active_calls\ndata: ${JSON.stringify(activeCalls)}\n\n`);

      const latency = await getMetricValues('audio_processing_latency');
      const avg = latency.length > 0 ? Math.round(latency.reduce((a, b) => a + b, 0) / latency.length) : 0;
      res.write(`event: metrics\ndata: ${JSON.stringify({ avgLatency: avg, samples: latency.slice(0, 20) })}\n\n`);

      const history = await getCallHistory(10);
      res.write(`event: call_history\ndata: ${JSON.stringify(history)}\n\n`);
    } catch {
      // ignore errors in SSE
    }
  };

  // Initial push
  sendUpdates();

  const interval = setInterval(sendUpdates, 2000);
  req.on('close', () => clearInterval(interval));
});

// Dashboard HTML (fallback)
router.get('/', (_req: Request, res: Response) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

export default router;
