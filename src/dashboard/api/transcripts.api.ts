import { Router, Request, Response } from 'express';
import { getTranscript, getAllActiveCalls } from '../../services/redis.service';

const router = Router();

router.get('/:callSid', async (req: Request, res: Response) => {
  try {
    const callSid = req.params.callSid as string;
    const transcript = await getTranscript(callSid);
    res.json(transcript);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch transcript' });
  }
});

// SSE stream for live transcript updates
router.get('/:callSid/stream', (req: Request, res: Response) => {
  const callSid = req.params.callSid as string;

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  let lastLength = 0;

  const interval = setInterval(async () => {
    try {
      const transcript = await getTranscript(callSid);
      if (transcript.length > lastLength) {
        const newEntries = transcript.slice(lastLength);
        for (const entry of newEntries) {
          res.write(`data: ${JSON.stringify(entry)}\n\n`);
        }
        lastLength = transcript.length;
      }
    } catch {
      // ignore
    }
  }, 1000);

  req.on('close', () => clearInterval(interval));
});

export default router;
