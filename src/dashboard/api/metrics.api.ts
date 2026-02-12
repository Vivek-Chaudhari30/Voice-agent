import { Router } from 'express';
import { getMetricValues, getCounter } from '../../services/redis.service';

const router = Router();

router.get('/', async (_req, res) => {
  try {
    const audioLatency = await getMetricValues('audio_processing_latency');
    const toolExecution = await getMetricValues('tool_execution');
    const callDuration = await getMetricValues('call_duration');

    const avg = (arr: number[]) => (arr.length > 0 ? Math.round(arr.reduce((a, b) => a + b, 0) / arr.length) : 0);

    const totalCalls = await getCounter('total_calls');
    const appointmentsBooked = await getCounter('appointments_booked');

    res.json({
      audioLatency: {
        avg: avg(audioLatency),
        samples: audioLatency.slice(0, 20),
      },
      toolExecution: {
        avg: avg(toolExecution),
        samples: toolExecution.slice(0, 20),
      },
      callDuration: {
        avg: avg(callDuration),
        samples: callDuration.slice(0, 20),
      },
      counters: {
        totalCalls,
        appointmentsBooked,
      },
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch metrics' });
  }
});

export default router;
