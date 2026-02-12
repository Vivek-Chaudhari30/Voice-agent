import { Router } from 'express';
import { getAllActiveCalls, getCallHistory } from '../../services/redis.service';
import { getRecentAppointments, getTodayAppointmentCount } from '../../services/database.service';

const router = Router();

router.get('/active', async (_req, res) => {
  try {
    const calls = await getAllActiveCalls();
    res.json(calls);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch active calls' });
  }
});

router.get('/history', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit as string) || 20;
    const history = await getCallHistory(limit);
    res.json(history);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch call history' });
  }
});

router.get('/appointments', async (_req, res) => {
  try {
    const appointments = getRecentAppointments(20);
    res.json(appointments);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch appointments' });
  }
});

router.get('/stats', async (_req, res) => {
  try {
    const activeCalls = await getAllActiveCalls();
    const todayBookings = getTodayAppointmentCount();
    const history = await getCallHistory(100);

    const totalCalls = history.length;
    const booked = history.filter((h) => h.outcome === 'appointment_booked').length;
    const successRate = totalCalls > 0 ? Math.round((booked / totalCalls) * 100) : 0;
    const avgDuration = totalCalls > 0 ? Math.round(history.reduce((s, h) => s + h.duration, 0) / totalCalls) : 0;

    res.json({
      activeCalls: activeCalls.length,
      todayBookings,
      totalCalls,
      successRate,
      avgDuration,
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch stats' });
  }
});

export default router;
