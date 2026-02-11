import Database from 'better-sqlite3';
import logger from '../utils/logger';

let db: Database.Database;

export function getDatabase(): Database.Database {
  if (!db) {
    throw new Error('Database not initialized. Call initDatabase() first.');
  }
  return db;
}

export function initDatabase(): void {
  db = new Database(':memory:');
  db.pragma('journal_mode = WAL');

  // Create tables
  db.exec(`
    CREATE TABLE IF NOT EXISTS available_slots (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      date TEXT NOT NULL,
      time TEXT NOT NULL,
      is_booked INTEGER DEFAULT 0,
      UNIQUE(date, time)
    );

    CREATE TABLE IF NOT EXISTS appointments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      customer_name TEXT NOT NULL,
      phone_number TEXT,
      date TEXT NOT NULL,
      time TEXT NOT NULL,
      created_at INTEGER DEFAULT (strftime('%s', 'now'))
    );

    CREATE INDEX IF NOT EXISTS idx_slots_date ON available_slots(date);
    CREATE INDEX IF NOT EXISTS idx_appointments_date ON appointments(date);
  `);

  seedSlots();
  logger.info('Database initialized and seeded');
}

/**
 * Seed available slots for the next 30 days.
 * Standard office hours: 9:00-11:30, 14:00-16:30 in 30-min increments.
 */
function seedSlots(): void {
  const times = [
    '09:00', '09:30', '10:00', '10:30', '11:00', '11:30',
    '14:00', '14:30', '15:00', '15:30', '16:00', '16:30',
  ];

  const insert = db.prepare('INSERT OR IGNORE INTO available_slots (date, time) VALUES (?, ?)');
  const insertMany = db.transaction(() => {
    const today = new Date();
    for (let d = 0; d < 30; d++) {
      const date = new Date(today);
      date.setDate(today.getDate() + d);
      // Skip weekends
      const day = date.getDay();
      if (day === 0 || day === 6) continue;

      const dateStr = date.toISOString().slice(0, 10); // YYYY-MM-DD
      for (const time of times) {
        insert.run(dateStr, time);
      }
    }
  });

  insertMany();

  const count = db.prepare('SELECT COUNT(*) as cnt FROM available_slots').get() as { cnt: number };
  logger.info({ slotCount: count.cnt }, 'Seeded available slots');
}
