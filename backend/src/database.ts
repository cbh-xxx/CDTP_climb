import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { emptySnapshot } from './snapshot.ts';
export function openDatabase(dir: string) {
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const db = new Database(join(dir, 'climb.sqlite'));
  try {
    db.pragma('foreign_keys = ON'); db.pragma('journal_mode = WAL'); db.pragma('busy_timeout = 5000');
    const migrations = [
      `CREATE TABLE accounts(id TEXT PRIMARY KEY, username TEXT NOT NULL UNIQUE, password_hash TEXT NOT NULL, created_at INTEGER NOT NULL);
       CREATE TABLE sessions(token_hash TEXT PRIMARY KEY, account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE, expires_at INTEGER NOT NULL);
       CREATE INDEX sessions_account ON sessions(account_id);
       CREATE TABLE business_snapshots(account_id TEXT PRIMARY KEY REFERENCES accounts(id), schema_version INTEGER NOT NULL, revision INTEGER NOT NULL, payload TEXT NOT NULL CHECK(json_valid(payload)), updated_at INTEGER NOT NULL);
       CREATE TABLE idempotency_records(account_id TEXT NOT NULL REFERENCES accounts(id), operation_id TEXT NOT NULL, request_hash TEXT NOT NULL, response_json TEXT NOT NULL CHECK(json_valid(response_json)), created_at INTEGER NOT NULL, PRIMARY KEY(account_id, operation_id));`,
      `CREATE INDEX sessions_expiry ON sessions(expires_at);`,
      `INSERT INTO business_snapshots(account_id,schema_version,revision,payload,updated_at) SELECT id,1,0,'${JSON.stringify(emptySnapshot())}',created_at FROM accounts WHERE id NOT IN (SELECT account_id FROM business_snapshots);`
    ];
    const version = db.pragma('user_version', { simple: true }) as number;
    if (version > migrations.length) throw new Error('Database schema is newer than this server');
    db.transaction(() => { for (let i = version; i < migrations.length; i++) { db.exec(migrations[i]); db.pragma(`user_version = ${i + 1}`); } })();
    return db;
  } catch (error) { db.close(); throw error; }
}
export type Db = ReturnType<typeof openDatabase>;
