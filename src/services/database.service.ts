import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import { logger } from '../utils/logger.util';
import { AppointmentRow } from '../types';

let db: Database.Database;

export async function initializeDatabase(): Promise<void> {
  const dbPath = process.env.DATABASE_PATH || path.resolve(process.cwd(), 'data', 'appointments.db');

  // Ensure data directory exists
  const dir = path.dirname(dbPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  db = new Database(dbPath);

  // Enable WAL mode for better concurrent read performance
  db.pragma('journal_mode = WAL');

  db.exec(`
    CREATE TABLE IF NOT EXISTS appointments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      customer_name TEXT NOT NULL,
      phone_number TEXT NOT NULL,
      appointment_date TEXT NOT NULL,
      appointment_time TEXT NOT NULL,
      confirmation_number TEXT UNIQUE NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      call_sid TEXT,
      status TEXT DEFAULT 'confirmed'
    );

    CREATE INDEX IF NOT EXISTS idx_appointment_datetime
      ON appointments(appointment_date, appointment_time);

    CREATE INDEX IF NOT EXISTS idx_confirmation
      ON appointments(confirmation_number);
  `);

  logger.info('SQLite database initialized', { path: dbPath });
}

export function getDatabase(): Database.Database {
  if (!db) throw new Error('Database not initialized');
  return db;
}

// ── Query helpers ────────────────────────────────────────────────────────────

export function getBookedSlots(date: string): string[] {
  return getDatabase()
    .prepare(`SELECT appointment_time FROM appointments WHERE appointment_date = ? AND status = 'confirmed'`)
    .all(date)
    .map((row: any) => row.appointment_time);
}

export function insertAppointment(params: {
  customerName: string;
  phoneNumber: string;
  date: string;
  time: string;
  confirmationNumber: string;
  callSid: string;
}): void {
  getDatabase()
    .prepare(
      `INSERT INTO appointments (customer_name, phone_number, appointment_date, appointment_time, confirmation_number, call_sid)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
    .run(
      params.customerName,
      params.phoneNumber,
      params.date,
      params.time,
      params.confirmationNumber,
      params.callSid
    );
}

export function isSlotBooked(date: string, time: string): boolean {
  const row = getDatabase()
    .prepare(`SELECT id FROM appointments WHERE appointment_date = ? AND appointment_time = ? AND status = 'confirmed'`)
    .get(date, time);
  return !!row;
}

export function getTodayAppointmentCount(): number {
  const today = new Date().toISOString().split('T')[0];
  const row: any = getDatabase()
    .prepare(`SELECT COUNT(*) as cnt FROM appointments WHERE appointment_date = ? AND status = 'confirmed'`)
    .get(today);
  return row?.cnt ?? 0;
}

export function getRecentAppointments(limit = 20): AppointmentRow[] {
  return getDatabase()
    .prepare(`SELECT * FROM appointments ORDER BY created_at DESC LIMIT ?`)
    .all(limit) as AppointmentRow[];
}
