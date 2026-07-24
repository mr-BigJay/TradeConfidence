const fs = require("node:fs");
const path = require("node:path");
const sqlite3 = require("sqlite3");
const { open } = require("sqlite");
const config = require("../config/config");

let db;

async function ensureColumn(database, tableName, columnName, definition) {
  const columns = await database.all(`PRAGMA table_info(${tableName})`);
  const exists = columns.some((column) => column.name === columnName);
  if (!exists) {
    await database.exec(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${definition}`);
  }
}

async function getDb() {
  if (db) {
    return db;
  }

  const dbPath = path.resolve(config.runtime.databasePath);
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });

  db = await open({
    filename: dbPath,
    driver: sqlite3.Database,
  });

  await db.exec(`
    CREATE TABLE IF NOT EXISTS content_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      symbol TEXT NOT NULL,
      text_hash TEXT NOT NULL,
      raw_text TEXT NOT NULL,
      scraped_at TEXT NOT NULL,
      source_updated_at TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_content_history_symbol_time
      ON content_history(symbol, scraped_at);

    CREATE TABLE IF NOT EXISTS analysis_results (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      symbol TEXT NOT NULL,
      text_hash TEXT NOT NULL,
      analysis_json TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS event_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      symbol TEXT,
      event TEXT NOT NULL,
      message TEXT,
      created_at TEXT NOT NULL
    );
  `);

  await ensureColumn(db, "content_history", "source_updated_at", "TEXT");

  return db;
}

async function getLatestContent(symbol) {
  const database = await getDb();

  return database.get(
    "SELECT * FROM content_history WHERE symbol = ? ORDER BY scraped_at DESC, id DESC LIMIT 1",
    symbol,
  );
}

async function saveContent({ symbol, textHash, rawText, scrapedAt, sourceUpdatedAt = null }) {
  const database = await getDb();

  return database.run(
    `INSERT INTO content_history
      (symbol, text_hash, raw_text, scraped_at, source_updated_at)
     VALUES (?, ?, ?, ?, ?)`,
    symbol,
    textHash,
    rawText,
    scrapedAt,
    sourceUpdatedAt,
  );
}

async function saveAnalysis({ symbol, textHash, analysis, createdAt }) {
  const database = await getDb();

  return database.run(
    "INSERT INTO analysis_results (symbol, text_hash, analysis_json, created_at) VALUES (?, ?, ?, ?)",
    symbol,
    textHash,
    JSON.stringify(analysis),
    createdAt,
  );
}

async function getLatestAnalysis(symbol) {
  const database = await getDb();
  const row = await database.get(
    "SELECT * FROM analysis_results WHERE symbol = ? ORDER BY created_at DESC, id DESC LIMIT 1",
    symbol,
  );

  if (!row) {
    return null;
  }

  try {
    return {
      ...row,
      analysis: JSON.parse(row.analysis_json),
    };
  } catch (error) {
    return row;
  }
}

async function saveEvent({ symbol = null, event, message = null, createdAt = new Date().toISOString() }) {
  const database = await getDb();

  return database.run(
    "INSERT INTO event_logs (symbol, event, message, created_at) VALUES (?, ?, ?, ?)",
    symbol,
    event,
    message,
    createdAt,
  );
}

async function closeDb() {
  if (!db) {
    return;
  }

  await db.close();
  db = null;
}

module.exports = {
  closeDb,
  getDb,
  getLatestAnalysis,
  getLatestContent,
  saveAnalysis,
  saveContent,
  saveEvent,
};
