import type { FastifyInstance } from 'fastify';
import { ADMIN_STALE_SOURCE_DAYS, canonicalCalendarUrl, promoteSourceSchema, type AdminOverviewDto } from '@planner/shared';
import type { Db } from '../db/index.ts';
import {
  adminCountActiveSessions,
  adminCountUsers,
  adminEventCacheStats,
  adminListCustomSources,
  adminListDefaultSources,
  adminListUsers,
  adminMarkSourceChecked,
  adminPromoteSourceToDefault,
  getSourceById,
  listPrograms,
  parseGroupPath,
} from '../db/repo.ts';
import { requireAdmin } from '../auth/session.ts';
import { getEventsForSource, SourceUnavailableError } from '../cineca/service.ts';

const STALE_MS = ADMIN_STALE_SOURCE_DAYS * 24 * 60 * 60 * 1000;

function dbSizeBytes(db: Db): number {
  const { page_count } = db.prepare('PRAGMA page_count').get() as { page_count: number };
  const { page_size } = db.prepare('PRAGMA page_size').get() as { page_size: number };
  return page_count * page_size;
}

export function registerAdminRoutes(app: FastifyInstance, db: Db): void {
  // GET /api/admin/overview
  app.get('/api/admin/overview', async (req, reply) => {
    if (!requireAdmin(db, req, reply)) return;

    const now = Date.now();
    const customSources = adminListCustomSources(db).map((s) => ({
      id: s.id,
      host: s.host,
      linkCalendarioId: s.link_calendario_id,
      title: s.title,
      titleEn: s.title_en,
      url: canonicalCalendarUrl(s.host, s.link_calendario_id),
      createdByEmail: s.creator_email,
      lastOkAt: s.last_ok_at,
      linkedUserCount: s.linked_user_count,
      stale: !s.last_ok_at || now - new Date(s.last_ok_at).getTime() > STALE_MS,
    }));

    const overview: AdminOverviewDto = {
      stats: {
        userCount: adminCountUsers(db),
        activeSessionCount: adminCountActiveSessions(db),
        eventCache: adminEventCacheStats(db),
        resource: {
          dbSizeBytes: dbSizeBytes(db),
          uptimeSeconds: process.uptime(),
          rssBytes: process.memoryUsage().rss,
        },
      },
      users: adminListUsers(db).map((u) => ({
        id: u.id,
        email: u.email,
        name: u.name,
        createdAt: u.created_at,
        pictureUrl: u.picture_url,
        viewCount: u.view_count,
        customSourceCount: u.custom_source_count,
      })),
      customSources,
      defaultSources: adminListDefaultSources(db).map((s) => ({
        id: s.id,
        host: s.host,
        linkCalendarioId: s.link_calendario_id,
        title: s.title,
        titleEn: s.title_en,
        url: canonicalCalendarUrl(s.host, s.link_calendario_id),
        program: s.program,
        groupPath: parseGroupPath(s.group_path),
        linkedUserCount: s.linked_user_count,
      })),
      existingPrograms: listPrograms(db).map((p) => p.program),
    };
    return overview;
  });

  // POST /api/admin/sources/:id/promote
  app.post('/api/admin/sources/:id/promote', async (req, reply) => {
    const admin = requireAdmin(db, req, reply);
    if (!admin) return;
    const id = Number((req.params as { id: string }).id);
    if (!Number.isInteger(id)) return reply.code(400).send({ error: 'invalid_id' });
    const parsed = promoteSourceSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'invalid_body', issues: parsed.error.issues });
    const source = adminPromoteSourceToDefault(db, id, parsed.data.program);
    if (!source) return reply.code(404).send({ error: 'not_found' });
    req.log.info({ adminEmail: admin.email, sourceId: id, program: parsed.data.program }, 'admin promoted source to default');
    return { ok: true };
  });

  // POST /api/admin/sources/:id/check
  app.post(
    '/api/admin/sources/:id/check',
    { config: { rateLimit: { max: 20, timeWindow: '1 minute' } } },
    async (req, reply) => {
      if (!requireAdmin(db, req, reply)) return;
      const id = Number((req.params as { id: string }).id);
      if (!Number.isInteger(id)) return reply.code(400).send({ error: 'invalid_id' });
      const source = getSourceById(db, id);
      if (!source) return reply.code(404).send({ error: 'not_found' });
      try {
        await getEventsForSource(
          db,
          { id: source.id, host: source.host, linkCalendarioId: source.link_calendario_id },
          new Date(),
          new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        );
        adminMarkSourceChecked(db, id);
        return { ok: true };
      } catch (err) {
        if (err instanceof SourceUnavailableError) return { ok: false, error: err.message };
        throw err;
      }
    },
  );
}
