import type { ViewSettings } from '@planner/shared';
import { defaultViewSettings } from '@planner/shared';
import { tx, type Db } from './index.ts';

export interface UserRow {
  id: number;
  google_sub: string;
  email: string;
  name: string;
  picture_url: string | null;
}

export interface SourceRow {
  id: number;
  kind: 'default' | 'custom';
  host: string;
  link_calendario_id: string;
  title: string;
  title_en: string | null;
  created_by: number | null;
  last_ok_at: string | null;
  group_path: string | null;
  program: string | null;
}

export interface ViewRow {
  id: number;
  user_id: number;
  name: string;
  position: number;
  settings: string;
  updated_at: string;
}

export function upsertUser(db: Db, sub: string, email: string, name: string, pictureUrl: string | null = null): UserRow {
  db.prepare(
    `INSERT INTO users (google_sub, email, name, picture_url) VALUES (?, ?, ?, ?)
     ON CONFLICT(google_sub) DO UPDATE SET email = excluded.email, name = excluded.name, picture_url = excluded.picture_url`,
  ).run(sub, email, name, pictureUrl);
  return db.prepare('SELECT * FROM users WHERE google_sub = ?').get(sub) as unknown as UserRow;
}

export function getUserById(db: Db, id: number): UserRow | undefined {
  return db.prepare('SELECT * FROM users WHERE id = ?').get(id) as UserRow | undefined;
}

export function createSession(db: Db, hash: string, userId: number, expiresAt: number): void {
  db.prepare('INSERT INTO sessions (id_hash, user_id, expires_at) VALUES (?, ?, ?)').run(hash, userId, expiresAt);
}

export function getSession(db: Db, hash: string): { user_id: number; expires_at: number } | undefined {
  return db.prepare('SELECT user_id, expires_at FROM sessions WHERE id_hash = ?').get(hash) as
    | { user_id: number; expires_at: number }
    | undefined;
}

export function deleteSession(db: Db, hash: string): void {
  db.prepare('DELETE FROM sessions WHERE id_hash = ?').run(hash);
}

export function touchSession(db: Db, hash: string, expiresAt: number): void {
  db.prepare('UPDATE sessions SET expires_at = ? WHERE id_hash = ?').run(expiresAt, hash);
}

export function purgeExpiredSessions(db: Db): void {
  db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(Date.now());
}

export function getHostClienteId(db: Db, host: string, ttlMs: number): string | undefined {
  const row = db.prepare('SELECT cliente_id, fetched_at FROM hosts WHERE host = ?').get(host) as
    | { cliente_id: string; fetched_at: number }
    | undefined;
  if (!row) return undefined;
  if (Date.now() - row.fetched_at > ttlMs) return undefined;
  return row.cliente_id;
}

export function saveHostClienteId(db: Db, host: string, clienteId: string): void {
  db.prepare(
    `INSERT INTO hosts (host, cliente_id, fetched_at) VALUES (?, ?, ?)
     ON CONFLICT(host) DO UPDATE SET cliente_id = excluded.cliente_id, fetched_at = excluded.fetched_at`,
  ).run(host, clienteId, Date.now());
}

export function findSource(db: Db, host: string, linkCalendarioId: string): SourceRow | undefined {
  return db.prepare('SELECT * FROM sources WHERE host = ? AND link_calendario_id = ?').get(host, linkCalendarioId) as
    | SourceRow
    | undefined;
}

export function getSourceById(db: Db, id: number): SourceRow | undefined {
  return db.prepare('SELECT * FROM sources WHERE id = ?').get(id) as SourceRow | undefined;
}

export function insertSource(
  db: Db,
  row: Pick<SourceRow, 'kind' | 'host' | 'link_calendario_id' | 'title' | 'title_en' | 'created_by'>,
): SourceRow {
  db.prepare(
    `INSERT INTO sources (kind, host, link_calendario_id, title, title_en, created_by, last_ok_at)
     VALUES (?, ?, ?, ?, ?, ?, datetime('now'))`,
  ).run(row.kind, row.host, row.link_calendario_id, row.title, row.title_en, row.created_by);
  return findSource(db, row.host, row.link_calendario_id)!;
}

/**
 * Inserts a default (config-seeded) source, or refreshes its title/group/program
 * if it already exists. Never touches a row that a user turned into a custom
 * source some other way - it only updates rows that are still 'default'.
 */
export function upsertDefaultSource(
  db: Db,
  row: Pick<SourceRow, 'host' | 'link_calendario_id' | 'title' | 'title_en' | 'group_path' | 'program'>,
): SourceRow {
  const existing = findSource(db, row.host, row.link_calendario_id);
  if (existing) {
    if (existing.kind === 'default') {
      db.prepare(
        'UPDATE sources SET title = ?, title_en = ?, group_path = ?, program = ?, last_ok_at = datetime(\'now\') WHERE id = ?',
      ).run(row.title, row.title_en, row.group_path, row.program, existing.id);
    }
    return findSource(db, row.host, row.link_calendario_id)!;
  }
  db.prepare(
    `INSERT INTO sources (kind, host, link_calendario_id, title, title_en, group_path, program, created_by, last_ok_at)
     VALUES ('default', ?, ?, ?, ?, ?, ?, NULL, datetime('now'))`,
  ).run(row.host, row.link_calendario_id, row.title, row.title_en, row.group_path, row.program);
  return findSource(db, row.host, row.link_calendario_id)!;
}

export function defaultSources(db: Db): SourceRow[] {
  return db.prepare("SELECT * FROM sources WHERE kind = 'default'").all() as unknown as SourceRow[];
}

function linkedSources(db: Db, userId: number, kind: 'default' | 'custom'): SourceRow[] {
  return db
    .prepare(
      `SELECT s.* FROM sources s
       JOIN user_sources us ON us.source_id = s.id
       WHERE us.user_id = ? AND s.kind = ?`,
    )
    .all(userId, kind) as unknown as SourceRow[];
}

export function userCustomSources(db: Db, userId: number): SourceRow[] {
  return linkedSources(db, userId, 'custom');
}

export function linkedDefaultSources(db: Db, userId: number): SourceRow[] {
  return linkedSources(db, userId, 'default');
}

export interface ProgramSources {
  program: string;
  sources: SourceRow[];
}

/** Every supported degree program (distinct `program` among default sources), each with its member sources, first-seen order. */
export function listPrograms(db: Db): ProgramSources[] {
  const order: string[] = [];
  const byProgram = new Map<string, SourceRow[]>();
  for (const s of defaultSources(db)) {
    if (!s.program) continue;
    if (!byProgram.has(s.program)) {
      byProgram.set(s.program, []);
      order.push(s.program);
    }
    byProgram.get(s.program)!.push(s);
  }
  return order.map((program) => ({ program, sources: byProgram.get(program)! }));
}

/**
 * Links every not-yet-added source of a degree program to the user, and
 * places the newly-linked ones into a "Corso di <program>" folder (one
 * subfolder per group_path) - reusing an existing same-named folder/subfolder
 * rather than creating a duplicate, so re-adding after a partial removal (or
 * after this program-based model replaced the old auto-seed) reattaches
 * instead of duplicating. Never touches a source the user already has access to.
 */
export function addProgramForUser(db: Db, userId: number, program: string): { added: number } {
  const sources = defaultSources(db).filter((s) => s.program === program);
  const newSources = sources.filter((s) => !userCanAccessSource(db, userId, s.id));
  if (newSources.length === 0) return { added: 0 };

  for (const s of newSources) linkUserSource(db, userId, s.id);

  const existingFolders = listUserFolders(db, userId);
  const rootName = `Corso di ${program}`;
  let root = existingFolders.find((f) => f.parent_id == null && f.name === rootName);
  if (!root) root = createUserFolder(db, userId, rootName);

  const subfoldersByGroup = new Map<string, FolderRow>();
  for (const f of existingFolders) {
    if (f.parent_id === root.id) subfoldersByGroup.set(f.name, f);
  }
  for (const source of newSources) {
    let targetFolderId = root.id;
    if (source.group_path) {
      let sub = subfoldersByGroup.get(source.group_path);
      if (!sub) {
        sub = createUserFolder(db, userId, source.group_path, root.id);
        subfoldersByGroup.set(source.group_path, sub);
      }
      targetFolderId = sub.id;
    }
    setSourcePlacement(db, userId, source.id, targetFolderId);
  }
  return { added: newSources.length };
}

export function countUserCustomSources(db: Db, userId: number): number {
  const row = db
    .prepare(
      `SELECT COUNT(*) as n FROM user_sources us JOIN sources s ON s.id = us.source_id
       WHERE us.user_id = ? AND s.kind = 'custom'`,
    )
    .get(userId) as { n: number };
  return row.n;
}

export function linkUserSource(db: Db, userId: number, sourceId: number): void {
  db.prepare('INSERT OR IGNORE INTO user_sources (user_id, source_id) VALUES (?, ?)').run(userId, sourceId);
}

export function unlinkUserSource(db: Db, userId: number, sourceId: number): void {
  tx(db, () => {
    db.prepare('DELETE FROM user_sources WHERE user_id = ? AND source_id = ?').run(userId, sourceId);
    db.prepare('DELETE FROM user_source_placements WHERE user_id = ? AND source_id = ?').run(userId, sourceId);
  });
}

export function userCanAccessSource(db: Db, userId: number, sourceId: number): boolean {
  const row = db
    .prepare('SELECT 1 FROM user_sources WHERE user_id = ? AND source_id = ?')
    .get(userId, sourceId);
  return Boolean(row);
}

export interface FolderRow {
  id: number;
  user_id: number;
  name: string;
  position: number;
  parent_id: number | null;
  created_at: string;
}

export function listUserFolders(db: Db, userId: number): FolderRow[] {
  return db
    .prepare('SELECT * FROM user_folders WHERE user_id = ? ORDER BY position ASC')
    .all(userId) as unknown as FolderRow[];
}

export function getUserFolder(db: Db, userId: number, folderId: number): FolderRow | undefined {
  return db.prepare('SELECT * FROM user_folders WHERE id = ? AND user_id = ?').get(folderId, userId) as
    | FolderRow
    | undefined;
}

export function countUserFolders(db: Db, userId: number): number {
  const row = db.prepare('SELECT COUNT(*) as n FROM user_folders WHERE user_id = ?').get(userId) as { n: number };
  return row.n;
}

export function createUserFolder(db: Db, userId: number, name: string, parentId: number | null = null): FolderRow {
  const pos = db
    .prepare('SELECT COALESCE(MAX(position), -1) + 1 as p FROM user_folders WHERE user_id = ? AND parent_id IS ?')
    .get(userId, parentId) as { p: number };
  db.prepare('INSERT INTO user_folders (user_id, name, position, parent_id) VALUES (?, ?, ?, ?)').run(
    userId,
    name,
    pos.p,
    parentId,
  );
  const row = db
    .prepare('SELECT * FROM user_folders WHERE user_id = ? ORDER BY id DESC LIMIT 1')
    .get(userId) as unknown as FolderRow;
  return row;
}

export function renameUserFolder(db: Db, userId: number, folderId: number, name: string): FolderRow | undefined {
  if (!getUserFolder(db, userId, folderId)) return undefined;
  db.prepare('UPDATE user_folders SET name = ? WHERE id = ? AND user_id = ?').run(name, folderId, userId);
  return getUserFolder(db, userId, folderId);
}

/**
 * Reparents a folder. Ownership of both the folder and the new parent (when
 * not null), and cycle-safety, are the caller's responsibility (see
 * isSelfOrDescendant in @planner/shared) - this just moves it and recomputes
 * its position scoped to the new parent so it doesn't collide with siblings.
 */
export function moveUserFolder(db: Db, userId: number, folderId: number, parentId: number | null): FolderRow | undefined {
  if (!getUserFolder(db, userId, folderId)) return undefined;
  const pos = db
    .prepare('SELECT COALESCE(MAX(position), -1) + 1 as p FROM user_folders WHERE user_id = ? AND parent_id IS ?')
    .get(userId, parentId) as { p: number };
  db.prepare('UPDATE user_folders SET parent_id = ?, position = ? WHERE id = ? AND user_id = ?').run(
    parentId,
    pos.p,
    folderId,
    userId,
  );
  return getUserFolder(db, userId, folderId);
}

export function deleteUserFolder(db: Db, userId: number, folderId: number): void {
  // Cascades to the whole subtree (ON DELETE CASCADE on parent_id), and
  // un-places every source anywhere in it (ON DELETE SET NULL).
  db.prepare('DELETE FROM user_folders WHERE id = ? AND user_id = ?').run(folderId, userId);
}

/** sourceId -> folderId (null = not in any folder) */
export function listUserPlacements(db: Db, userId: number): Map<number, number | null> {
  const rows = db
    .prepare('SELECT source_id, folder_id FROM user_source_placements WHERE user_id = ?')
    .all(userId) as unknown as { source_id: number; folder_id: number | null }[];
  return new Map(rows.map((row) => [row.source_id, row.folder_id]));
}

export function setSourcePlacement(db: Db, userId: number, sourceId: number, folderId: number | null): void {
  db.prepare(
    `INSERT INTO user_source_placements (user_id, source_id, folder_id) VALUES (?, ?, ?)
     ON CONFLICT(user_id, source_id) DO UPDATE SET folder_id = excluded.folder_id`,
  ).run(userId, sourceId, folderId);
}

function parseView(row: ViewRow): { id: number; name: string; position: number; settings: ViewSettings; updatedAt: string } {
  let settings: ViewSettings;
  try {
    settings = JSON.parse(row.settings);
  } catch {
    settings = defaultViewSettings();
  }
  return { id: row.id, name: row.name, position: row.position, settings, updatedAt: row.updated_at };
}

export function listViews(db: Db, userId: number) {
  const rows = db.prepare('SELECT * FROM views WHERE user_id = ? ORDER BY position ASC').all(userId) as unknown as ViewRow[];
  return rows.map(parseView);
}

export function getView(db: Db, userId: number, viewId: number) {
  const row = db.prepare('SELECT * FROM views WHERE id = ? AND user_id = ?').get(viewId, userId) as ViewRow | undefined;
  return row ? parseView(row) : undefined;
}

export function createView(db: Db, userId: number, name: string, settings: ViewSettings) {
  const pos = db.prepare('SELECT COALESCE(MAX(position), -1) + 1 as p FROM views WHERE user_id = ?').get(userId) as {
    p: number;
  };
  db.prepare(
    `INSERT INTO views (user_id, name, position, settings, updated_at)
     VALUES (?, ?, ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`,
  ).run(userId, name, pos.p, JSON.stringify(settings));
  const row = db
    .prepare('SELECT * FROM views WHERE user_id = ? ORDER BY id DESC LIMIT 1')
    .get(userId) as unknown as ViewRow;
  return parseView(row);
}

export function updateView(db: Db, userId: number, viewId: number, patch: { name?: string; settings?: ViewSettings }) {
  const existing = getView(db, userId, viewId);
  if (!existing) return undefined;
  const name = patch.name ?? existing.name;
  const settings = patch.settings ?? existing.settings;
  db.prepare(
    `UPDATE views SET name = ?, settings = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
     WHERE id = ? AND user_id = ?`,
  ).run(name, JSON.stringify(settings), viewId, userId);
  return getView(db, userId, viewId);
}

export function deleteView(db: Db, userId: number, viewId: number): void {
  db.prepare('DELETE FROM views WHERE id = ? AND user_id = ?').run(viewId, userId);
}

export function reorderViews(db: Db, userId: number, orderedIds: number[]): void {
  const stmt = db.prepare('UPDATE views SET position = ? WHERE id = ? AND user_id = ?');
  tx(db, () => {
    orderedIds.forEach((id, index) => stmt.run(index, id, userId));
  });
}

export function getPrefs(db: Db, userId: number): { activeViewId: number | null; lang: 'it' | 'en' } {
  const row = db.prepare('SELECT active_view_id, lang FROM user_prefs WHERE user_id = ?').get(userId) as
    | { active_view_id: number | null; lang: string | null }
    | undefined;
  return { activeViewId: row?.active_view_id ?? null, lang: (row?.lang as 'it' | 'en') ?? 'it' };
}

export function setPrefs(db: Db, userId: number, patch: { activeViewId?: number | null; lang?: string }): void {
  const current = getPrefs(db, userId);
  const activeViewId = patch.activeViewId !== undefined ? patch.activeViewId : current.activeViewId;
  const lang = patch.lang ?? current.lang;
  db.prepare(
    `INSERT INTO user_prefs (user_id, active_view_id, lang) VALUES (?, ?, ?)
     ON CONFLICT(user_id) DO UPDATE SET active_view_id = excluded.active_view_id, lang = excluded.lang`,
  ).run(userId, activeViewId, lang);
}

export function getCachedWeek(db: Db, sourceId: number, weekStart: string, ttlMs: number): unknown[] | undefined {
  const row = db
    .prepare('SELECT payload, fetched_at FROM event_cache WHERE source_id = ? AND week_start = ?')
    .get(sourceId, weekStart) as { payload: string; fetched_at: number } | undefined;
  if (!row) return undefined;
  if (Date.now() - row.fetched_at > ttlMs) return undefined;
  try {
    return JSON.parse(row.payload);
  } catch {
    return undefined;
  }
}

export function saveCachedWeek(db: Db, sourceId: number, weekStart: string, events: unknown[]): void {
  db.prepare(
    `INSERT INTO event_cache (source_id, week_start, payload, fetched_at) VALUES (?, ?, ?, ?)
     ON CONFLICT(source_id, week_start) DO UPDATE SET payload = excluded.payload, fetched_at = excluded.fetched_at`,
  ).run(sourceId, weekStart, JSON.stringify(events), Date.now());
}
