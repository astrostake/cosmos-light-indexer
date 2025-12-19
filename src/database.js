import Database from 'better-sqlite3';

export const initDB = (dbPath) => {
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');

  db.exec(`
    CREATE TABLE IF NOT EXISTS validators (
      operator_address TEXT PRIMARY KEY,
      moniker TEXT,
      details TEXT,
      commission_rate TEXT,
      last_updated DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS history_unjail (
      tx_hash TEXT,
      operator_address TEXT,
      block_height INTEGER,
      timestamp DATETIME,
      PRIMARY KEY (tx_hash, operator_address)
    );

    CREATE TABLE IF NOT EXISTS history_edits (
      tx_hash TEXT,
      operator_address TEXT,
      field_changed TEXT,
      block_height INTEGER,
      timestamp DATETIME,
      PRIMARY KEY (tx_hash, operator_address)
    );

    CREATE TABLE IF NOT EXISTS history_votes (
      tx_hash TEXT,
      proposal_id INTEGER,
      operator_address TEXT,
      vote_option TEXT,
      timestamp DATETIME,
      PRIMARY KEY (proposal_id, operator_address)
    );

    CREATE TABLE IF NOT EXISTS sync_status (
      action_type TEXT PRIMARY KEY,
      last_height INTEGER DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS active_upgrade (
      plan_name TEXT PRIMARY KEY,
      target_height INTEGER,
      start_time INTEGER,
      estimated_time INTEGER,
      info TEXT, 
      last_checked DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS history_delegator_stats (
      operator_address TEXT,
      snapshot_date TEXT,
      delegator_count INTEGER,
      total_staked TEXT,
      timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (operator_address, snapshot_date)
    );
  `);

  return db;
};