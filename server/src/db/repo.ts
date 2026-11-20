import type { CourseDto, CustomEventData, CustomEventDto, GuestImportData, ViewSettings } from '@planner/shared';
import type { PlacedSource, SiblingRef } from '@planner/shared';
import {
  collectSubtreeIds,
  customEventDataSchema,
  defaultViewSettings,
  MAX_CUSTOM_EVENTS_PER_USER,
  MAX_EVENT_LABELS_PER_USER,
  MAX_VIEWS_PER_USER,
  siblingOrderAfterMove,
  viewSettingsSchema,
} from '@planner/shared';
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
  share_token: string | null;
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

/** Encodes a folder path (root to leaf) for storage in sources.group_path; [] becomes null. */
export function encodeGroupPath(path: string[]): string | null {
  return path.length > 0 ? JSON.stringify(path) : null;
}

/** Decodes sources.group_path back into a folder path. A plain non-JSON string (pre-nesting format) is treated as a single segment. */
export function parseGroupPath(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed.filter((s): s is string => typeof s === 'string');
  } catch {
    // legacy plain-string value
  }
  return [raw];
}

/**
 * Inserts a default (config-seeded) source, or refreshes its title/group/program
 * if it already exists. A config entry always wins: if the row already exists
 * as a user-submitted custom source, this promotes it to default too, so a
 * calendar stops showing as a pending submission once it's curated into the
 * official config.
 */
export function upsertDefaultSource(
  db: Db,
  row: Pick<SourceRow, 'host' | 'link_calendario_id' | 'title' | 'title_en' | 'group_path' | 'program'>,
): SourceRow {
  const existing = findSource(db, row.host, row.link_calendario_id);
  if (existing) {
    db.prepare(
      "UPDATE sources SET kind = 'default', title = ?, title_en = ?, group_path = ?, program = ?, last_ok_at = datetime('now') WHERE id = ?",
    ).run(row.title, row.title_en, row.group_path, row.program, existing.id);
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
 * places the newly-linked ones into a "Corso di <program>" folder, walking
 * each source's group_path into nested subfolders as deep as it goes -
 * reusing an existing same-named folder/subfolder at each level rather than
 * creating a duplicate, so re-adding after a partial removal (or after this
 * program-based model replaced the old auto-seed) reattaches instead of
 * duplicating. Never touches a source the user already has access to.
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

  const folderByParentAndName = new Map<string, FolderRow>();
  for (const f of existingFolders) folderByParentAndName.set(`${f.parent_id}:${f.name}`, f);
  folderByParentAndName.set(`null:${rootName}`, root);

  function resolveSubfolder(parent: FolderRow, name: string): FolderRow {
    const key = `${parent.id}:${name}`;
    let folder = folderByParentAndName.get(key);
    if (!folder) {
      folder = createUserFolder(db, userId, name, parent.id);
      folderByParentAndName.set(key, folder);
    }
    return folder;
  }

  for (const source of newSources) {
    let target = root;
    for (const segment of parseGroupPath(source.group_path)) target = resolveSubfolder(target, segment);
    setSourcePlacement(db, userId, source.id, target.id);
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

/** Drops the user's link/placement to a source. Not wrapped in its own tx so callers can batch several under one. */
function unlinkUserSourceCore(db: Db, userId: number, sourceId: number): void {
  db.prepare('DELETE FROM user_sources WHERE user_id = ? AND source_id = ?').run(userId, sourceId);
  db.prepare('DELETE FROM user_source_placements WHERE user_id = ? AND source_id = ?').run(userId, sourceId);
  pruneSourceFromViews(db, userId, sourceId);
}

export function unlinkUserSource(db: Db, userId: number, sourceId: number): void {
  tx(db, () => unlinkUserSourceCore(db, userId, sourceId));
}

/** Removes a source's course selections from every one of the user's views, so a removed source's choices don't linger or resurface if the source is re-added later. */
function pruneSourceFromViews(db: Db, userId: number, sourceId: number): void {
  for (const view of listViews(db, userId)) {
    if (!view.settings.sources.some((s) => s.sourceId === sourceId)) continue;
    updateView(db, userId, view.id, {
      settings: { ...view.settings, sources: view.settings.sources.filter((s) => s.sourceId !== sourceId) },
    });
  }
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

/** Position that puts something after every current child (subfolders and placed sources) of parentId. */
function nextChildPosition(db: Db, userId: number, parentId: number | null): number {
  // A null folder_id never matches "=", so the root counts folders only
  const row = db
    .prepare(
      `SELECT COALESCE(MAX(p), -1) + 1 AS p FROM (
         SELECT position AS p FROM user_folders WHERE user_id = ? AND parent_id IS ?
         UNION ALL
         SELECT position AS p FROM user_source_placements WHERE user_id = ? AND folder_id = ?
       )`,
    )
    .get(userId, parentId, userId, parentId) as { p: number };
  return row.p;
}

function folderNodes(db: Db, userId: number) {
  return listUserFolders(db, userId).map((f) => ({ id: f.id, name: f.name, position: f.position, parentId: f.parent_id }));
}

/** Every source the user has a placement row for, with its folder and position. */
function placedSources(db: Db, userId: number): PlacedSource[] {
  const rows = db
    .prepare('SELECT source_id, folder_id, position FROM user_source_placements WHERE user_id = ?')
    .all(userId) as unknown as { source_id: number; folder_id: number | null; position: number }[];
  return rows.map((r) => ({ id: r.source_id, folderId: r.folder_id, position: r.position }));
}

/** Renumbers a folder's children 0..n in the given order. Not wrapped in its own tx so callers can batch it. */
function writeChildOrder(db: Db, userId: number, order: SiblingRef[]): void {
  const setFolder = db.prepare('UPDATE user_folders SET position = ? WHERE id = ? AND user_id = ?');
  const setSource = db.prepare('UPDATE user_source_placements SET position = ? WHERE source_id = ? AND user_id = ?');
  order.forEach((item, position) => (item.kind === 'folder' ? setFolder : setSource).run(position, item.id, userId));
}

export function createUserFolder(db: Db, userId: number, name: string, parentId: number | null = null): FolderRow {
  db.prepare('INSERT INTO user_folders (user_id, name, position, parent_id) VALUES (?, ?, ?, ?)').run(
    userId,
    name,
    nextChildPosition(db, userId, parentId),
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
 * Reparents and/or reorders a folder. Ownership of both the folder and the new
 * parent (when not null), and cycle-safety, are the caller's responsibility
 * (see isSelfOrDescendant in @planner/shared). The folder lands at index among
 * the new parent's other children, subfolders and sources alike (appended when
 * omitted), and those children are renumbered so positions stay unique and
 * contiguous.
 */
export function moveUserFolder(
  db: Db,
  userId: number,
  folderId: number,
  parentId: number | null,
  index?: number,
): FolderRow | undefined {
  if (!getUserFolder(db, userId, folderId)) return undefined;
  const order = siblingOrderAfterMove(folderNodes(db, userId), placedSources(db, userId), { kind: 'folder', id: folderId }, parentId, index);
  tx(db, () => {
    db.prepare('UPDATE user_folders SET parent_id = ? WHERE id = ? AND user_id = ?').run(parentId, folderId, userId);
    writeChildOrder(db, userId, order);
  });
  return getUserFolder(db, userId, folderId);
}

/**
 * Deletes a folder and its whole subtree, along with every source placed
 * anywhere in it - a folder's contents are meant to go together, so this
 * removes those sources from the user's list (like deleting them one by
 * one) rather than merely un-placing them back to the root.
 */
export function deleteUserFolder(db: Db, userId: number, folderId: number): void {
  const nodes = folderNodes(db, userId);
  const affected = new Set([folderId, ...collectSubtreeIds(nodes, folderId)]);
  const placements = listUserPlacements(db, userId);
  const sourceIds = [...placements.entries()].filter(([, fid]) => fid != null && affected.has(fid)).map(([sid]) => sid);
  tx(db, () => {
    for (const sourceId of sourceIds) unlinkUserSourceCore(db, userId, sourceId);
    // Cascades to the whole subtree (ON DELETE CASCADE on parent_id).
    db.prepare('DELETE FROM user_folders WHERE id = ? AND user_id = ?').run(folderId, userId);
  });
}

/** sourceId -> folderId (null = not in any folder) */
export function listUserPlacements(db: Db, userId: number): Map<number, number | null> {
  const rows = db
    .prepare('SELECT source_id, folder_id FROM user_source_placements WHERE user_id = ?')
    .all(userId) as unknown as { source_id: number; folder_id: number | null }[];
  return new Map(rows.map((row) => [row.source_id, row.folder_id]));
}

/**
 * Puts a source in a folder (null = root) at index among that folder's other
 * children, subfolders and sources alike. Omitted index appends; the root is
 * not ordered, so an index there is ignored.
 */
export function setSourcePlacement(db: Db, userId: number, sourceId: number, folderId: number | null, index?: number): void {
  tx(db, () => {
    if (folderId == null || index === undefined) {
      db.prepare(
        `INSERT INTO user_source_placements (user_id, source_id, folder_id, position) VALUES (?, ?, ?, ?)
         ON CONFLICT(user_id, source_id) DO UPDATE SET folder_id = excluded.folder_id, position = excluded.position`,
      ).run(userId, sourceId, folderId, folderId == null ? 0 : nextChildPosition(db, userId, folderId));
      return;
    }
    db.prepare(
      `INSERT INTO user_source_placements (user_id, source_id, folder_id) VALUES (?, ?, ?)
       ON CONFLICT(user_id, source_id) DO UPDATE SET folder_id = excluded.folder_id`,
    ).run(userId, sourceId, folderId);
    writeChildOrder(
      db,
      userId,
      siblingOrderAfterMove(folderNodes(db, userId), placedSources(db, userId), { kind: 'source', id: sourceId }, folderId, index),
    );
  });
}

/** sourceId -> position among its folder's children. */
export function listUserSourcePositions(db: Db, userId: number): Map<number, number> {
  return new Map(placedSources(db, userId).map((s) => [s.id, s.position]));
}

/** sourceId -> per-user rename override, for sources that have one. */
export function listUserSourceNames(db: Db, userId: number): Map<number, string> {
  const rows = db
    .prepare('SELECT source_id, custom_name FROM user_source_placements WHERE user_id = ? AND custom_name IS NOT NULL')
    .all(userId) as unknown as { source_id: number; custom_name: string }[];
  return new Map(rows.map((row) => [row.source_id, row.custom_name]));
}

export function renameUserSource(db: Db, userId: number, sourceId: number, name: string): void {
  db.prepare(
    `INSERT INTO user_source_placements (user_id, source_id, folder_id, custom_name) VALUES (?, ?, NULL, ?)
     ON CONFLICT(user_id, source_id) DO UPDATE SET custom_name = excluded.custom_name`,
  ).run(userId, sourceId, name);
}

/** Stored settings with schema defaults filled in; rows saved before a settings field existed stay readable. Unreadable JSON falls back to defaults. */
function parseSettings(raw: string): ViewSettings {
  try {
    const parsed = viewSettingsSchema.safeParse(JSON.parse(raw));
    if (parsed.success) return parsed.data;
  } catch {
    // Bad JSON
  }
  return defaultViewSettings();
}

function parseView(row: ViewRow) {
  const settings = parseSettings(row.settings);
  return {
    id: row.id,
    name: row.name,
    position: row.position,
    settings,
    updatedAt: row.updated_at,
    shareToken: row.share_token,
  };
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

/** Sets or clears (token = null) a view's public share token. Returns undefined if the view isn't the user's. */
export function setViewShareToken(db: Db, userId: number, viewId: number, token: string | null) {
  if (!getView(db, userId, viewId)) return undefined;
  db.prepare('UPDATE views SET share_token = ? WHERE id = ? AND user_id = ?').run(token, viewId, userId);
  return getView(db, userId, viewId);
}

export function getViewByShareToken(db: Db, token: string) {
  const row = db.prepare('SELECT * FROM views WHERE share_token = ?').get(token) as ViewRow | undefined;
  return row ? parseView(row) : undefined;
}

/** Owner and settings behind a share token. The owner id is for server-side lookups only and must never reach a response. */
export function getSharedViewContext(db: Db, token: string): { userId: number; settings: ViewSettings } | undefined {
  const row = db.prepare('SELECT user_id, settings FROM views WHERE share_token = ?').get(token) as
    | { user_id: number; settings: string }
    | undefined;
  return row ? { userId: row.user_id, settings: parseSettings(row.settings) } : undefined;
}

export function reorderViews(db: Db, userId: number, orderedIds: number[]): void {
  const stmt = db.prepare('UPDATE views SET position = ? WHERE id = ? AND user_id = ?');
  tx(db, () => {
    orderedIds.forEach((id, index) => stmt.run(index, id, userId));
  });
}

export interface EventLabelRow {
  id: number;
  user_id: number;
  name: string;
  color: string;
  created_at: string;
}

export interface CustomEventRow {
  id: number;
  user_id: number;
  label_id: number | null;
  data: string;
  created_at: string;
  updated_at: string;
}

export type EventLabelData = Pick<EventLabelRow, 'name' | 'color'>;

export function listEventLabels(db: Db, userId: number): EventLabelRow[] {
  return db
    .prepare('SELECT * FROM custom_event_labels WHERE user_id = ? ORDER BY id ASC')
    .all(userId) as unknown as EventLabelRow[];
}

export function getEventLabel(db: Db, userId: number, id: number): EventLabelRow | undefined {
  return db.prepare('SELECT * FROM custom_event_labels WHERE id = ? AND user_id = ?').get(id, userId) as
    | EventLabelRow
    | undefined;
}

export function createEventLabel(db: Db, userId: number, input: EventLabelData): EventLabelRow | 'limit' {
  return tx(db, () => {
    const count = db.prepare('SELECT COUNT(*) AS n FROM custom_event_labels WHERE user_id = ?').get(userId) as { n: number };
    if (count.n >= MAX_EVENT_LABELS_PER_USER) return 'limit' as const;
    const res = db
      .prepare('INSERT INTO custom_event_labels (user_id, name, color) VALUES (?, ?, ?)')
      .run(userId, input.name, input.color);
    return getEventLabel(db, userId, Number(res.lastInsertRowid))!;
  });
}

export function updateEventLabel(db: Db, userId: number, id: number, input: EventLabelData): EventLabelRow | undefined {
  if (!getEventLabel(db, userId, id)) return undefined;
  db.prepare('UPDATE custom_event_labels SET name = ?, color = ? WHERE id = ? AND user_id = ?').run(
    input.name,
    input.color,
    id,
    userId,
  );
  return getEventLabel(db, userId, id);
}

/** Deletes a label; its events keep existing without one (FK), and views stop listing it as hidden. */
export function deleteEventLabel(db: Db, userId: number, id: number): boolean {
  return tx(db, () => {
    const res = db.prepare('DELETE FROM custom_event_labels WHERE id = ? AND user_id = ?').run(id, userId);
    if (Number(res.changes) === 0) return false;
    // Stale ids would otherwise linger in hiddenLabels and count against its cap
    for (const view of listViews(db, userId)) {
      const { customEvents } = view.settings;
      if (!customEvents.hiddenLabels.includes(id)) continue;
      updateView(db, userId, view.id, {
        settings: {
          ...view.settings,
          customEvents: { ...customEvents, hiddenLabels: customEvents.hiddenLabels.filter((x) => x !== id) },
        },
      });
    }
    return true;
  });
}

function customEventDto(row: CustomEventRow, data: Omit<CustomEventData, 'labelId'>): CustomEventDto {
  return { ...data, labelId: row.label_id, id: row.id, updatedAt: row.updated_at };
}

/** Stored data is re-validated on every read, so a row that no longer passes the schema is skipped instead of reaching clients. */
function readCustomEvent(row: CustomEventRow): CustomEventDto | undefined {
  try {
    const parsed = customEventDataSchema.safeParse(JSON.parse(row.data));
    if (parsed.success) return customEventDto(row, parsed.data);
  } catch {
    // Bad JSON
  }
  // Id only; event content stays out of logs
  console.warn(`custom event ${row.id} skipped: stored data is invalid`);
  return undefined;
}

function selectCustomEventRow(db: Db, userId: number, id: number): CustomEventRow | undefined {
  return db.prepare('SELECT * FROM custom_events WHERE id = ? AND user_id = ?').get(id, userId) as
    | CustomEventRow
    | undefined;
}

export function listCustomEvents(db: Db, userId: number): CustomEventDto[] {
  const rows = db
    .prepare('SELECT * FROM custom_events WHERE user_id = ? ORDER BY id ASC')
    .all(userId) as unknown as CustomEventRow[];
  return rows.flatMap((row) => readCustomEvent(row) ?? []);
}

export function getCustomEvent(db: Db, userId: number, id: number): CustomEventDto | undefined {
  const row = selectCustomEventRow(db, userId, id);
  return row ? readCustomEvent(row) : undefined;
}

/** Ownership check that ignores stored content, so a row with invalid data can still be replaced or deleted. */
export function hasCustomEvent(db: Db, userId: number, id: number): boolean {
  return selectCustomEventRow(db, userId, id) !== undefined;
}

export function createCustomEvent(db: Db, userId: number, input: CustomEventData): CustomEventDto | 'limit' | 'invalid_label' {
  const { labelId, ...data } = input;
  return tx(db, () => {
    const count = db.prepare('SELECT COUNT(*) AS n FROM custom_events WHERE user_id = ?').get(userId) as { n: number };
    if (count.n >= MAX_CUSTOM_EVENTS_PER_USER) return 'limit' as const;
    if (labelId !== null && !getEventLabel(db, userId, labelId)) return 'invalid_label' as const;
    const res = db
      .prepare('INSERT INTO custom_events (user_id, label_id, data) VALUES (?, ?, ?)')
      .run(userId, labelId, JSON.stringify(data));
    return customEventDto(selectCustomEventRow(db, userId, Number(res.lastInsertRowid))!, data);
  });
}

/** Full replace of an event the user owns. */
export function updateCustomEvent(
  db: Db,
  userId: number,
  id: number,
  input: CustomEventData,
): CustomEventDto | 'not_found' | 'invalid_label' {
  const { labelId, ...data } = input;
  return tx(db, () => {
    if (!selectCustomEventRow(db, userId, id)) return 'not_found' as const;
    if (labelId !== null && !getEventLabel(db, userId, labelId)) return 'invalid_label' as const;
    db.prepare(
      `UPDATE custom_events SET label_id = ?, data = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
       WHERE id = ? AND user_id = ?`,
    ).run(labelId, JSON.stringify(data), id, userId);
    return customEventDto(selectCustomEventRow(db, userId, id)!, data);
  });
}

export function deleteCustomEvent(db: Db, userId: number, id: number): boolean {
  const res = db.prepare('DELETE FROM custom_events WHERE id = ? AND user_id = ?').run(id, userId);
  return Number(res.changes) > 0;
}

export type GuestImportResult = 'ok' | 'too_many_event_labels' | 'too_many_custom_events' | 'too_many_views';

function countRows(db: Db, table: 'custom_event_labels' | 'custom_events' | 'views', userId: number): number {
  const row = db.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE user_id = ?`).get(userId) as { n: number };
  return row.n;
}

/**
 * Imports a guest's labels, events and views in one transaction: all of it or
 * nothing. Incoming events and views reference labels by the guest's own refs,
 * which are remapped to the new ids; an unknown ref becomes "no label".
 */
export function importGuestData(db: Db, userId: number, data: GuestImportData): GuestImportResult {
  return tx(db, () => {
    if (countRows(db, 'custom_event_labels', userId) + data.labels.length > MAX_EVENT_LABELS_PER_USER) {
      return 'too_many_event_labels' as const;
    }
    if (countRows(db, 'custom_events', userId) + data.events.length > MAX_CUSTOM_EVENTS_PER_USER) {
      return 'too_many_custom_events' as const;
    }
    if (countRows(db, 'views', userId) + data.views.length > MAX_VIEWS_PER_USER) {
      return 'too_many_views' as const;
    }

    const insertLabel = db.prepare('INSERT INTO custom_event_labels (user_id, name, color) VALUES (?, ?, ?)');
    const idByRef = new Map<number, number>();
    for (const label of data.labels) {
      const res = insertLabel.run(userId, label.name, label.color);
      idByRef.set(label.ref, Number(res.lastInsertRowid));
    }

    const insertEvent = db.prepare('INSERT INTO custom_events (user_id, label_id, data) VALUES (?, ?, ?)');
    for (const { labelId, ...event } of data.events) {
      insertEvent.run(userId, labelId === null ? null : (idByRef.get(labelId) ?? null), JSON.stringify(event));
    }

    // createView does not open its own transaction
    for (const view of data.views) {
      const { customEvents } = view.settings;
      const hiddenLabels = [...new Set(customEvents.hiddenLabels.flatMap((ref) => idByRef.get(ref) ?? []))];
      createView(db, userId, view.name, { ...view.settings, customEvents: { ...customEvents, hiddenLabels } });
    }
    return 'ok' as const;
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

/** Cached course list with its build time; age policy is left to the caller. */
export function getCachedCourses(db: Db, sourceId: number): { courses: CourseDto[]; fetchedAt: number } | undefined {
  const row = db.prepare('SELECT payload, fetched_at FROM course_cache WHERE source_id = ?').get(sourceId) as
    | { payload: string; fetched_at: number }
    | undefined;
  if (!row) return undefined;
  try {
    return { courses: JSON.parse(row.payload) as CourseDto[], fetchedAt: row.fetched_at };
  } catch {
    return undefined;
  }
}

/** Build time per source id, without loading the payloads. */
export function courseCacheBuildTimes(db: Db): Map<number, number> {
  const rows = db.prepare('SELECT source_id, fetched_at FROM course_cache').all() as unknown as Array<{
    source_id: number;
    fetched_at: number;
  }>;
  return new Map(rows.map((r) => [r.source_id, r.fetched_at]));
}

export function saveCachedCourses(db: Db, sourceId: number, courses: CourseDto[]): void {
  db.prepare(
    `INSERT INTO course_cache (source_id, payload, fetched_at) VALUES (?, ?, ?)
     ON CONFLICT(source_id) DO UPDATE SET payload = excluded.payload, fetched_at = excluded.fetched_at`,
  ).run(sourceId, JSON.stringify(courses), Date.now());
}

export function adminCountUsers(db: Db): number {
  const row = db.prepare('SELECT COUNT(*) as n FROM users').get() as { n: number };
  return row.n;
}

export interface AdminUserRow {
  id: number;
  email: string;
  name: string;
  created_at: string;
  picture_url: string | null;
  view_count: number;
  custom_source_count: number;
}

/** Every registered user, newest first, with cheap per-user counts via correlated subqueries. */
export function adminListUsers(db: Db): AdminUserRow[] {
  return db
    .prepare(
      `SELECT u.id, u.email, u.name, u.created_at, u.picture_url,
         (SELECT COUNT(*) FROM views v WHERE v.user_id = u.id) as view_count,
         (SELECT COUNT(*) FROM sources s WHERE s.created_by = u.id AND s.kind = 'custom') as custom_source_count
       FROM users u
       ORDER BY u.created_at DESC`,
    )
    .all() as unknown as AdminUserRow[];
}

export interface AdminCustomSourceRow extends SourceRow {
  creator_email: string | null;
  linked_user_count: number;
}

/** Every custom source across all users (not just one user's), newest-verified first. */
export function adminListCustomSources(db: Db): AdminCustomSourceRow[] {
  return db
    .prepare(
      `SELECT s.*, u.email as creator_email,
         (SELECT COUNT(*) FROM user_sources us WHERE us.source_id = s.id) as linked_user_count
       FROM sources s
       LEFT JOIN users u ON u.id = s.created_by
       WHERE s.kind = 'custom'
       ORDER BY s.last_ok_at DESC`,
    )
    .all() as unknown as AdminCustomSourceRow[];
}

export interface AdminDefaultSourceRow extends SourceRow {
  linked_user_count: number;
}

/** Every predefined (config-seeded or promoted) source, grouped for display by program then title. */
export function adminListDefaultSources(db: Db): AdminDefaultSourceRow[] {
  return db
    .prepare(
      `SELECT s.*,
         (SELECT COUNT(*) FROM user_sources us WHERE us.source_id = s.id) as linked_user_count
       FROM sources s
       WHERE s.kind = 'default'
       ORDER BY s.program IS NULL, s.program, s.title`,
    )
    .all() as unknown as AdminDefaultSourceRow[];
}

export function adminCountActiveSessions(db: Db): number {
  const row = db.prepare('SELECT COUNT(*) as n FROM sessions WHERE expires_at > ?').get(Date.now()) as { n: number };
  return row.n;
}

export interface EventCacheStats {
  rowCount: number;
  distinctSourceCount: number;
  newestFetchedAt: number | null;
}

export function adminEventCacheStats(db: Db): EventCacheStats {
  return db
    .prepare(
      `SELECT COUNT(*) as rowCount, COUNT(DISTINCT source_id) as distinctSourceCount, MAX(fetched_at) as newestFetchedAt
       FROM event_cache`,
    )
    .get() as unknown as EventCacheStats;
}

/**
 * Flips a custom source to default and assigns it a program, so it starts
 * showing up via listPrograms/the program picker (a default source with no
 * program is invisible - see listPrograms). The kind = 'custom' guard makes
 * this a safe no-op against an already-default or missing id - it never
 * un-defaults anything or double-applies.
 */
export function adminPromoteSourceToDefault(db: Db, sourceId: number, program: string): SourceRow | undefined {
  const existing = getSourceById(db, sourceId);
  if (!existing || existing.kind !== 'custom') return undefined;
  db.prepare("UPDATE sources SET kind = 'default', program = ? WHERE id = ? AND kind = 'custom'").run(program, sourceId);
  return getSourceById(db, sourceId);
}

/** Only place a custom source's last_ok_at is refreshed after creation - called after a live admin health probe succeeds. */
export function adminMarkSourceChecked(db: Db, sourceId: number): void {
  db.prepare("UPDATE sources SET last_ok_at = datetime('now') WHERE id = ?").run(sourceId);
}
