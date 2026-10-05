import type { FastifyInstance } from 'fastify';
import type { FolderDto, ProgramDto, SourceDto } from '@planner/shared';
import {
  canonicalCalendarUrl,
  MAX_COURSES_RANGE_DAYS,
  MAX_CUSTOM_SOURCES_PER_USER,
  sourcePlacementSchema,
  sourceRenameSchema,
} from '@planner/shared';
import type { Db } from '../db/index.ts';
import {
  countUserCustomSources,
  getSourceById,
  getUserFolder,
  linkedDefaultSources,
  linkUserSource,
  listPrograms,
  listUserFolders,
  listUserPlacements,
  listUserSourceNames,
  listUserSourcePositions,
  parseGroupPath,
  renameUserSource,
  setSourcePlacement,
  unlinkUserSource,
  userCanAccessSource,
  userCustomSources,
  type FolderRow,
  type ProgramSources,
  type SourceRow,
} from '../db/repo.ts';
import { currentUser } from '../auth/session.ts';
import { loadCourses } from '../courses.ts';
import { validateSourceUrl, persistValidatedSource } from '../sources/validate.ts';
import { SourceUnavailableError } from '../cineca/service.ts';

function toDto(row: SourceRow, folderId: number | null, displayName: string | null = null, position = 0): SourceDto {
  return {
    id: row.id,
    kind: row.kind,
    host: row.host,
    linkCalendarioId: row.link_calendario_id,
    title: row.title,
    titleEn: row.title_en,
    url: canonicalCalendarUrl(row.host, row.link_calendario_id),
    groupPath: parseGroupPath(row.group_path),
    folderId,
    position,
    displayName,
  };
}

function toFolderDto(row: FolderRow): FolderDto {
  return { id: row.id, name: row.name, position: row.position, parentId: row.parent_id };
}

function toProgramDto(p: ProgramSources, linkedDefaultIds: Set<number>): ProgramDto {
  return {
    program: p.program,
    sources: p.sources.map((s) => toDto(s, null)),
    added: p.sources.every((s) => linkedDefaultIds.has(s.id)),
  };
}

export function registerSourceRoutes(app: FastifyInstance, db: Db): void {
  // GET /api/sources
  app.get('/api/sources', async (req, reply) => {
    const user = currentUser(db, req, reply);
    const placements = user ? listUserPlacements(db, user.id) : new Map();
    const names = user ? listUserSourceNames(db, user.id) : new Map();
    const positions = user ? listUserSourcePositions(db, user.id) : new Map();
    const toUserDto = (s: SourceRow) => toDto(s, placements.get(s.id) ?? null, names.get(s.id) ?? null, positions.get(s.id) ?? 0);
    const defaults = user ? linkedDefaultSources(db, user.id).map(toUserDto) : [];
    const custom = user ? userCustomSources(db, user.id).map(toUserDto) : [];
    const folders = user ? listUserFolders(db, user.id).map(toFolderDto) : [];
    const linkedDefaultIds = new Set(defaults.map((s) => s.id));
    const programs: ProgramDto[] = listPrograms(db).map((p) => toProgramDto(p, linkedDefaultIds));
    return { defaults, custom, folders, programs };
  });

  // POST /api/sources/validate
  app.post(
    '/api/sources/validate',
    { config: { rateLimit: { max: 15, timeWindow: '1 minute' } } },
    async (req) => {
      const body = req.body as { url?: unknown };
      const result = await validateSourceUrl(db, body.url);
      // Failed validation is expected user input, not an HTTP error - keep status 200 so the
      // client resolves the structured { ok: false, error } body instead of throwing.
      if (!result.ok) return { ok: false, error: result.error };
      return { ok: true, host: result.host, title: result.title, titleEn: result.titleEn, url: result.canonicalUrl };
    },
  );

  // POST /api/sources
  // Works logged-out too (guest mode keeps its view settings in
  // localStorage, referencing the shared source row by id) - only
  // linking the source to a synced account list requires a session.
  app.post(
    '/api/sources',
    { config: { rateLimit: { max: 15, timeWindow: '1 minute' } } },
    async (req, reply) => {
      const user = currentUser(db, req, reply);
      if (user && countUserCustomSources(db, user.id) >= MAX_CUSTOM_SOURCES_PER_USER) {
        return reply.code(400).send({ error: 'too_many_sources' });
      }
      const body = req.body as { url?: unknown };
      const result = await validateSourceUrl(db, body.url);
      // Same as /api/sources/validate - expected input error, keep status 200.
      if (!result.ok) return { ok: false, error: result.error };
      const source = persistValidatedSource(db, result, user?.id ?? null);
      if (user) linkUserSource(db, user.id, source.id);
      return { ok: true, source: toDto(source, null) };
    },
  );

  // DELETE /api/sources/:id
  app.delete('/api/sources/:id', async (req, reply) => {
    const user = currentUser(db, req, reply);
    if (!user) return reply.code(401).send({ error: 'unauthenticated' });
    const id = Number((req.params as { id: string }).id);
    if (!Number.isInteger(id)) return reply.code(400).send({ error: 'invalid_id' });
    unlinkUserSource(db, user.id, id);
    return { ok: true };
  });

  // PUT /api/sources/:id/placement
  app.put('/api/sources/:id/placement', async (req, reply) => {
    const user = currentUser(db, req, reply);
    if (!user) return reply.code(401).send({ error: 'unauthenticated' });
    const id = Number((req.params as { id: string }).id);
    if (!Number.isInteger(id)) return reply.code(400).send({ error: 'invalid_id' });
    if (!userCanAccessSource(db, user.id, id)) return reply.code(404).send({ error: 'not_found' });
    const parsed = sourcePlacementSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'invalid_body', issues: parsed.error.issues });
    if (parsed.data.folderId != null && !getUserFolder(db, user.id, parsed.data.folderId)) {
      return reply.code(400).send({ error: 'invalid_folder' });
    }
    setSourcePlacement(db, user.id, id, parsed.data.folderId, parsed.data.index);
    return { ok: true };
  });

  // PUT /api/sources/:id/name
  app.put('/api/sources/:id/name', async (req, reply) => {
    const user = currentUser(db, req, reply);
    if (!user) return reply.code(401).send({ error: 'unauthenticated' });
    const id = Number((req.params as { id: string }).id);
    if (!Number.isInteger(id)) return reply.code(400).send({ error: 'invalid_id' });
    if (!userCanAccessSource(db, user.id, id)) return reply.code(404).send({ error: 'not_found' });
    const parsed = sourceRenameSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'invalid_body', issues: parsed.error.issues });
    renameUserSource(db, user.id, id, parsed.data.name);
    return { ok: true };
  });

  // GET /api/sources/:id/courses
  app.get('/api/sources/:id/courses', async (req, reply) => {
    const id = Number((req.params as { id: string }).id);
    if (!Number.isInteger(id)) return reply.code(400).send({ error: 'invalid_id' });
    const source = getSourceById(db, id);
    if (!source) return reply.code(404).send({ error: 'not_found' });

    const query = req.query as { from?: string; to?: string };
    const from = query.from ? new Date(query.from) : new Date();
    const to = query.to ? new Date(query.to) : new Date(from.getTime() + 365 * 24 * 60 * 60 * 1000);
    const maxRangeMs = MAX_COURSES_RANGE_DAYS * 24 * 60 * 60 * 1000;
    if (
      Number.isNaN(from.getTime()) ||
      Number.isNaN(to.getTime()) ||
      to <= from ||
      to.getTime() - from.getTime() > maxRangeMs
    ) {
      return reply.code(400).send({ error: 'invalid_range' });
    }

    const refresh = (req.query as { refresh?: string }).refresh === '1';
    try {
      return { courses: await loadCourses(db, source, { from, to, refresh }, req.log) };
    } catch (err) {
      if (err instanceof SourceUnavailableError) return reply.code(502).send({ error: err.message });
      throw err;
    }
  });
}
