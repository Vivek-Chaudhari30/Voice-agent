import { getDatabase } from './database';
import logger from '../utils/logger';

export interface SlotResult {
  slots: string[];
  count: number;
  date: string;
}

export interface AppointmentResult {
  success: boolean;
  appointmentId?: number;
  error?: string;
  details?: {
    customer_name: string;
    date: string;
    time: string;
  };
}

/**
 * Returns available (un-booked) time slots for the given date.
 */
export function listAvailableSlots(date: string): SlotResult {
  const db = getDatabase();

  const slots = db
    .prepare('SELECT time FROM available_slots WHERE date = ? AND is_booked = 0 ORDER BY time')
    .all(date) as { time: string }[];

  const result: SlotResult = {
    slots: slots.map((s) => s.time),
    count: slots.length,
    date,
  };

  logger.info({ date, availableCount: result.count }, 'Listed available slots');
  return result;
}

/**
 * Books an appointment: marks the slot as taken and inserts an appointment row.
 */
export function createAppointment(
  customerName: string,
  date: string,
  time: string,
  phoneNumber?: string,
): AppointmentResult {
  const db = getDatabase();

  // Check availability
  const slot = db
    .prepare('SELECT id FROM available_slots WHERE date = ? AND time = ? AND is_booked = 0')
    .get(date, time) as { id: number } | undefined;

  if (!slot) {
    logger.warn({ date, time }, 'Attempted to book unavailable slot');
    return { success: false, error: `The ${time} slot on ${date} is no longer available.` };
  }

  const tx = db.transaction(() => {
    db.prepare('UPDATE available_slots SET is_booked = 1 WHERE id = ?').run(slot.id);

    const result = db
      .prepare('INSERT INTO appointments (customer_name, phone_number, date, time) VALUES (?, ?, ?, ?)')
      .run(customerName, phoneNumber || null, date, time);

    return result.lastInsertRowid as number;
  });

  const appointmentId = tx();

  logger.info({ appointmentId, customerName, date, time }, 'Appointment created');

  return {
    success: true,
    appointmentId,
    details: { customer_name: customerName, date, time },
  };
}
