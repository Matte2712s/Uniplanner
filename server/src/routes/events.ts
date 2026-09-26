import type { FastifyInstance } from 'fastify';
import type { CalendarEventDto, EventsResponse } from '@planner/shared';
import { eventsQuerySchema, isCourseVisible, MAX_RANGE_DAYS, viewSettingsSchema } from '@planner/shared';
import type { Db } from '../db/index.ts';
import { getSourceById, getView } from '../db/repo.ts';
import { requireUser } from '../auth/session.ts';
import { getEventsForSource, SourceUnavailableError } from '../cineca/service.ts';

const DAY_MS = 24 * 60 * 60 * 1000;

async function mergeEvents(
  db: Db,
  settings: import('@planner/shared').ViewSettings,
  from: Date,
  to: Date,
): Promise<EventsResponse> {
  const events: CalendarEventDto[] = [];
  const errors: EventsResponse['errors'] = [];

  await Promise.all(
    settings.sources.map(async (viewSource) => {
      const source = getSourceById(db, viewSource.sourceId);
      if (!source) {
        errors.push({ sourceId: viewSource.sourceId, message: 'source_not_found' });
        return;
      }
      try {
        const sourceEvents = await getEventsForSource(
          db,
          { id: source.id, host: source.host, linkCalendarioId: source.link_calendario_id },
          from,
          to,
        );
        for (const ev of sourceEvents) {
          if (ev.status === 'cancelled' && !settings.showCancelled) continue;
          if (isCourseVisible(viewSource, ev.courseKey)) events.push(ev);
        }
      } catch (err) {
        errors.push({
          sourceId: viewSource.sourceId,
          message: err instanceof SourceUnavailableError ? err.message : 'fetch_failed',
        });
      }
    }),
  );

  events.sort((a, b) => a.start.localeCompare(b.start));
  return { events, errors };
}

function parseRange(from: string, to: string): { from: Date; to: Date } | null {
  const fromDate = new Date(from);
  const toDate = new Date(to);
  if (Number.isNaN(fromDate.getTime()) || Number.isNaN(toDate.getTime())) return null;
  if (toDate <= fromDate) return null;
  if (toDate.getTime() - fromDate.getTime() > MAX_RANGE_DAYS * DAY_MS) return null;
  return { from: fromDate, to: toDate };
}

export function registerEventRoutes(app: FastifyInstance, db: Db): void {
  // POST /api/events/preview
  app.post('/api/events/preview', async (req, reply) => {
    const parsed = eventsQuerySchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'invalid_body', issues: parsed.error.issues });
    const range = parseRange(parsed.data.from, parsed.data.to);
    if (!range) return reply.code(400).send({ error: 'invalid_range' });
    return mergeEvents(db, parsed.data.settings, range.from, range.to);
  });

  // GET /api/events
  app.get('/api/events', async (req, reply) => {
    const user = requireUser(db, req, reply);
    if (!user) return;
    const query = req.query as { view?: string; from?: string; to?: string };
    const viewId = Number(query.view);
    if (!Number.isInteger(viewId) || !query.from || !query.to) {
      return reply.code(400).send({ error: 'invalid_query' });
    }
    const view = getView(db, user.id, viewId);
    if (!view) return reply.code(404).send({ error: 'not_found' });
    const range = parseRange(query.from, query.to);
    if (!range) return reply.code(400).send({ error: 'invalid_range' });
    const settings = viewSettingsSchema.parse(view.settings);
    return mergeEvents(db, settings, range.from, range.to);
  });
}
