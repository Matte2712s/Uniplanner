import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

// Ordered; each entry runs once
const migrations: string[] = [
  `
  CREATE TABLE users (
    id INTEGER PRIMARY KEY,
    google_sub TEXT NOT NULL UNIQUE,
    email TEXT NOT NULL,
    name TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE sessions (
    id_hash TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at INTEGER NOT NULL
  );
  CREATE INDEX sessions_user ON sessions(user_id);
  CREATE TABLE sources (
    id INTEGER PRIMARY KEY,
    kind TEXT NOT NULL CHECK (kind IN ('default', 'custom')),
    host TEXT NOT NULL,
    link_calendario_id TEXT NOT NULL,
    title TEXT NOT NULL,
    title_en TEXT,
    created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    last_ok_at TEXT,
    UNIQUE (host, link_calendario_id)
  );
  CREATE TABLE hosts (
    host TEXT PRIMARY KEY,
    cliente_id TEXT NOT NULL,
    fetched_at INTEGER NOT NULL
  );
  CREATE TABLE user_sources (
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    source_id INTEGER NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
    PRIMARY KEY (user_id, source_id)
  );
  CREATE TABLE views (
    id INTEGER PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    position INTEGER NOT NULL,
    settings TEXT NOT NULL,
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  );
  CREATE INDEX views_user ON views(user_id, position);
  CREATE TABLE user_prefs (
    user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    active_view_id INTEGER REFERENCES views(id) ON DELETE SET NULL,
    lang TEXT
  );
  CREATE TABLE event_cache (
    source_id INTEGER NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
    week_start TEXT NOT NULL,
    payload TEXT NOT NULL,
    fetched_at INTEGER NOT NULL,
    PRIMARY KEY (source_id, week_start)
  );
  `,
  // Folder grouping for the source picker (e.g. "Primo anno")
  `ALTER TABLE sources ADD COLUMN group_path TEXT;`,
  // Google account profile picture, for the account menu avatar
  `ALTER TABLE users ADD COLUMN picture_url TEXT;`,
  // User-defined sidebar folders, and per-user overrides (folder placement,
  // hidden state) for any source - including shared "default" rows, which
  // have no other per-user row of their own.
  `
  CREATE TABLE user_folders (
    id INTEGER PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    position INTEGER NOT NULL,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  );
  CREATE INDEX user_folders_user ON user_folders(user_id, position);
  CREATE TABLE user_source_placements (
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    source_id INTEGER NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
    folder_id INTEGER REFERENCES user_folders(id) ON DELETE SET NULL,
    hidden INTEGER NOT NULL DEFAULT 0 CHECK (hidden IN (0, 1)),
    PRIMARY KEY (user_id, source_id)
  );
  CREATE INDEX user_source_placements_folder ON user_source_placements(folder_id);
  `,
  // One-time marker so every user gets a real, editable "Corso di
  // Informatica" folder pre-populated with the default sources - once. If
  // they rename, empty out or delete it afterwards, that sticks; it's never
  // recreated (same "offer once" precedent as the guest-import prompt).
  `ALTER TABLE user_prefs ADD COLUMN informatica_folder_seeded INTEGER NOT NULL DEFAULT 0;`,
  // Nested folders: a folder can live inside another one. Cascades
  // multi-level automatically (foreign_keys is on), so deleting a folder
  // deletes its whole subtree and un-places every source that was in it.
  `ALTER TABLE user_folders ADD COLUMN parent_id INTEGER REFERENCES user_folders(id) ON DELETE CASCADE;`,
  // Default sources become opt-in per supported degree program instead of
  // visible to everyone unconditionally: "hidden" and the old one-time
  // auto-seed marker are both fully superseded by the user_sources link now
  // being required for default sources too (see userCanAccessSource).
  `
  ALTER TABLE sources ADD COLUMN program TEXT;
  ALTER TABLE user_source_placements DROP COLUMN hidden;
  ALTER TABLE user_prefs DROP COLUMN informatica_folder_seeded;
  `,
  // Per-user rename override for a source (title/title_en are shared config
  // data, so a personal rename has to live on the per-user placement row).
  `ALTER TABLE user_source_placements ADD COLUMN custom_name TEXT;`,
  // Public read-only share link for a view: a random token, unique when set.
  // NULL means the view isn't shared.
  `
  ALTER TABLE views ADD COLUMN share_token TEXT;
  CREATE UNIQUE INDEX views_share_token ON views(share_token) WHERE share_token IS NOT NULL;
  `,
  // Derived course list per source, cached long: rebuilding it costs ~58 upstream weekly fetches
  `
  CREATE TABLE course_cache (
    source_id INTEGER PRIMARY KEY REFERENCES sources(id) ON DELETE CASCADE,
    payload TEXT NOT NULL,
    fetched_at INTEGER NOT NULL
  );
  `,
  // Sources order among their folder's subfolders (same position space as user_folders.position)
  `ALTER TABLE user_source_placements ADD COLUMN position INTEGER NOT NULL DEFAULT 0;`,
];

export type Db = DatabaseSync;

export function openDb(file: string): Db {
  if (file !== ':memory:') mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
  db.exec('CREATE TABLE IF NOT EXISTS schema_version (version INTEGER NOT NULL)');
  const row = db.prepare('SELECT version FROM schema_version').get() as { version: number } | undefined;
  let version = row?.version ?? 0;
  if (!row) db.prepare('INSERT INTO schema_version (version) VALUES (0)').run();
  while (version < migrations.length) {
    db.exec('BEGIN');
    try {
      db.exec(migrations[version]!);
      version += 1;
      db.prepare('UPDATE schema_version SET version = ?').run(version);
      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }
  }
  return db;
}

export function tx<T>(db: Db, fn: () => T): T {
  db.exec('BEGIN');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}
