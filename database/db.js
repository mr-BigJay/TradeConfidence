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

  await db.exec(`
    CREATE TABLE IF NOT EXISTS daily_setups (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      symbol TEXT NOT NULL,
      iran_date TEXT NOT NULL,
      created_at TEXT NOT NULL,
      valid_until TEXT NOT NULL,
      direction TEXT NOT NULL,
      bias TEXT,
      confidence INTEGER,
      market_score INTEGER,
      risk_level TEXT,
      risk_notes TEXT,
      entry TEXT NOT NULL,
      stop_loss TEXT NOT NULL,
      tp1 TEXT,
      tp2 TEXT,
      tp3 TEXT,
      supports_json TEXT NOT NULL,
      resistances_json TEXT NOT NULL,
      setup_json TEXT NOT NULL,
      bitunix_snapshot_json TEXT,
      status TEXT NOT NULL DEFAULT 'Active',
      UNIQUE(symbol, iran_date)
    );

    CREATE TABLE IF NOT EXISTS setup_evaluations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      setup_id INTEGER NOT NULL,
      symbol TEXT NOT NULL,
      created_at TEXT NOT NULL,
      research_text_hash TEXT,
      research_source_updated_at TEXT,
      setup_status TEXT NOT NULL,
      confidence INTEGER,
      market_score INTEGER,
      rationale TEXT,
      evaluation_json TEXT NOT NULL,
      bitunix_1h_json TEXT,
      telegram_sent INTEGER DEFAULT 0
    );

    CREATE INDEX IF NOT EXISTS idx_daily_setups_symbol_date
      ON daily_setups(symbol, iran_date);
    CREATE INDEX IF NOT EXISTS idx_setup_eval_setup_time
      ON setup_evaluations(setup_id, created_at);
  `);

  return db;
}

function parseSetupRow(row) {
  if (!row) return null;
  let setup = {};
  let supports = [];
  let resistances = [];
  try {
    setup = JSON.parse(row.setup_json || "{}");
  } catch (error) {
    setup = {};
  }
  try {
    supports = JSON.parse(row.supports_json || "[]");
  } catch (error) {
    supports = [];
  }
  try {
    resistances = JSON.parse(row.resistances_json || "[]");
  } catch (error) {
    resistances = [];
  }

  return {
    ...row,
    supports,
    resistances,
    setup,
  };
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

async function hasTelegramSuccessForHash(symbol, textHash) {
  if (!symbol || !textHash) {
    return false;
  }

  const database = await getDb();

  // Content is saved only after successful Telegram delivery in the current pipeline.
  // For older DBs that saved content too early, also require a telegram_success
  // event at/after that scrape timestamp.
  const content = await database.get(
    `SELECT scraped_at FROM content_history
     WHERE symbol = ? AND text_hash = ?
     ORDER BY id DESC LIMIT 1`,
    symbol,
    textHash,
  );

  if (!content) {
    return false;
  }

  const delivery = await database.get(
    `SELECT id FROM event_logs
     WHERE symbol = ? AND event = 'telegram_success' AND created_at >= ?
     ORDER BY id DESC LIMIT 1`,
    symbol,
    content.scraped_at,
  );

  return Boolean(delivery);
}

async function getRecentEvents(symbol, limit = 20) {
  const database = await getDb();
  return database.all(
    `SELECT created_at, event, message FROM event_logs
     WHERE symbol = ? OR symbol IS NULL
     ORDER BY id DESC LIMIT ?`,
    symbol,
    limit,
  );
}

async function getDailySetupByIranDate(symbol, iranDate) {
  const database = await getDb();
  const row = await database.get(
    `SELECT * FROM daily_setups WHERE symbol = ? AND iran_date = ? LIMIT 1`,
    symbol,
    iranDate,
  );
  return parseSetupRow(row);
}

async function getActiveDailySetup(symbol, iranDate) {
  const database = await getDb();
  const row = await database.get(
    `SELECT * FROM daily_setups
     WHERE symbol = ? AND iran_date = ? AND status != 'Expired'
     LIMIT 1`,
    symbol,
    iranDate,
  );
  return parseSetupRow(row);
}

async function saveDailySetup(setup) {
  const database = await getDb();
  await database.run(
    `INSERT INTO daily_setups (
      symbol, iran_date, created_at, valid_until, direction, bias, confidence,
      market_score, risk_level, risk_notes, entry, stop_loss, tp1, tp2, tp3,
      supports_json, resistances_json, setup_json, bitunix_snapshot_json, status
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(symbol, iran_date) DO UPDATE SET
      created_at=excluded.created_at,
      valid_until=excluded.valid_until,
      direction=excluded.direction,
      bias=excluded.bias,
      confidence=excluded.confidence,
      market_score=excluded.market_score,
      risk_level=excluded.risk_level,
      risk_notes=excluded.risk_notes,
      entry=excluded.entry,
      stop_loss=excluded.stop_loss,
      tp1=excluded.tp1,
      tp2=excluded.tp2,
      tp3=excluded.tp3,
      supports_json=excluded.supports_json,
      resistances_json=excluded.resistances_json,
      setup_json=excluded.setup_json,
      bitunix_snapshot_json=excluded.bitunix_snapshot_json,
      status=excluded.status`,
    setup.symbol,
    setup.iran_date,
    setup.created_at,
    setup.valid_until,
    setup.direction,
    setup.bias,
    setup.confidence,
    setup.market_score,
    setup.risk_level,
    setup.risk_notes,
    setup.entry,
    setup.stop_loss,
    setup.tp1,
    setup.tp2,
    setup.tp3,
    JSON.stringify(setup.supports || []),
    JSON.stringify(setup.resistances || []),
    JSON.stringify(setup.setup || setup),
    JSON.stringify(setup.bitunix_snapshot || null),
    setup.status || "Active",
  );

  return getDailySetupByIranDate(setup.symbol, setup.iran_date);
}

async function updateDailySetupStatus(setupId, status, confidence = null, marketScore = null) {
  const database = await getDb();
  if (confidence === null && marketScore === null) {
    await database.run(`UPDATE daily_setups SET status = ? WHERE id = ?`, status, setupId);
  } else {
    await database.run(
      `UPDATE daily_setups
       SET status = ?,
           confidence = COALESCE(?, confidence),
           market_score = COALESCE(?, market_score)
       WHERE id = ?`,
      status,
      confidence,
      marketScore,
      setupId,
    );
  }
}

async function saveSetupEvaluation(evaluation) {
  const database = await getDb();
  const result = await database.run(
    `INSERT INTO setup_evaluations (
      setup_id, symbol, created_at, research_text_hash, research_source_updated_at,
      setup_status, confidence, market_score, rationale, evaluation_json,
      bitunix_1h_json, telegram_sent
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    evaluation.setup_id,
    evaluation.symbol,
    evaluation.created_at,
    evaluation.research_text_hash || null,
    evaluation.research_source_updated_at || null,
    evaluation.setup_status,
    evaluation.confidence,
    evaluation.market_score,
    evaluation.rationale || "",
    JSON.stringify(evaluation.evaluation || evaluation),
    JSON.stringify(evaluation.bitunix_1h || null),
    evaluation.telegram_sent ? 1 : 0,
  );
  return result.lastID;
}

async function getLatestSetupEvaluation(setupId) {
  const database = await getDb();
  const row = await database.get(
    `SELECT * FROM setup_evaluations WHERE setup_id = ? ORDER BY id DESC LIMIT 1`,
    setupId,
  );
  if (!row) return null;
  try {
    return { ...row, evaluation: JSON.parse(row.evaluation_json || "{}") };
  } catch (error) {
    return row;
  }
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
  getActiveDailySetup,
  getDailySetupByIranDate,
  getLatestAnalysis,
  getLatestContent,
  getLatestSetupEvaluation,
  getRecentEvents,
  hasTelegramSuccessForHash,
  saveAnalysis,
  saveContent,
  saveDailySetup,
  saveEvent,
  saveSetupEvaluation,
  updateDailySetupStatus,
};
