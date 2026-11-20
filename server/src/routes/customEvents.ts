import type { FastifyInstance } from 'fastify';
import type { CustomEventsResponse, EventLabelDto } from '@planner/shared';
import { customEventInputSchema, eventLabelInputSchema, guestImportSchema } from '@planner/shared';
import type { Db } from '../db/index.ts';
import {
  createCustomEvent,
  createEventLabel,
  deleteCustomEvent,
  deleteEventLabel,
  getEventLabel,
  hasCustomEvent,
  importGuestData,
  listCustomEvents,
  listEventLabels,
  updateCustomEvent,
  updateEventLabel,
  type EventLabelRow,
} from '../db/repo.ts';
import { requireUser } from '../auth/session.ts';

// Largest stored event is 16 KB; request bodies get the same cap
const BODY_LIMIT = 16384;
const rateLimit = { config: { rateLimit: { max: 60, timeWindow: '1 minute' } } };
const writeOptions = { bodyLimit: BODY_LIMIT, ...rateLimit };
// Guest views carry full settings, so the batch body can be far larger than one event
const GUEST_IMPORT_BODY_LIMIT = 4 * 1024 * 1024;
// Rare, heavy operation: much stricter than single writes
const guestImportOptions = {
  bodyLimit: GUEST_IMPORT_BODY_LIMIT,
  config: { rateLimit: { max: 5, timeWindow: '1 minute' } },
};

function toLabelDto(row: EventLabelRow): EventLabelDto {
  return { id: row.id, name: row.name, color: row.color };
}

/** Positive integer id from a route param, or null. */
function parseId(raw: unknown): number | null {
  const id = Number(raw);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

export function registerCustomEventRoutes(app: FastifyInstance, db: Db): void {
  // GET /api/custom-events
  app.get('/api/custom-events', async (req, reply) => {
    const user = requireUser(db, req, reply);
    if (!user) return;
    return {
      events: listCustomEvents(db, user.id),
      labels: listEventLabels(db, user.id).map(toLabelDto),
    } satisfies CustomEventsResponse;
  });

  // POST /api/custom-events
  app.post('/api/custom-events', writeOptions, async (req, reply) => {
    const user = requireUser(db, req, reply);
    if (!user) return;
    const parsed = customEventInputSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'invalid_body', issues: parsed.error.issues });
    const result = createCustomEvent(db, user.id, parsed.data);
    if (result === 'limit') return reply.code(400).send({ error: 'too_many_custom_events' });
    if (result === 'invalid_label') return reply.code(400).send({ error: 'invalid_label' });
    return { event: result };
  });

  // PUT /api/custom-events/:id
  app.put('/api/custom-events/:id', writeOptions, async (req, reply) => {
    const user = requireUser(db, req, reply);
    if (!user) return;
    const id = parseId((req.params as { id: string }).id);
    if (id === null) return reply.code(400).send({ error: 'invalid_id' });
    if (!hasCustomEvent(db, user.id, id)) return reply.code(404).send({ error: 'not_found' });
    const parsed = customEventInputSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'invalid_body', issues: parsed.error.issues });
    const result = updateCustomEvent(db, user.id, id, parsed.data);
    if (result === 'not_found') return reply.code(404).send({ error: 'not_found' });
    if (result === 'invalid_label') return reply.code(400).send({ error: 'invalid_label' });
    return { event: result };
  });

  // DELETE /api/custom-events/:id
  app.delete('/api/custom-events/:id', rateLimit, async (req, reply) => {
    const user = requireUser(db, req, reply);
    if (!user) return;
    const id = parseId((req.params as { id: string }).id);
    if (id === null) return reply.code(400).send({ error: 'invalid_id' });
    if (!deleteCustomEvent(db, user.id, id)) return reply.code(404).send({ error: 'not_found' });
    return { ok: true };
  });

  // POST /api/event-labels
  app.post('/api/event-labels', writeOptions, async (req, reply) => {
    const user = requireUser(db, req, reply);
    if (!user) return;
    const parsed = eventLabelInputSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'invalid_body', issues: parsed.error.issues });
    const result = createEventLabel(db, user.id, parsed.data);
    if (result === 'limit') return reply.code(400).send({ error: 'too_many_event_labels' });
    return { label: toLabelDto(result) };
  });

  // PUT /api/event-labels/:id
  app.put('/api/event-labels/:id', writeOptions, async (req, reply) => {
    const user = requireUser(db, req, reply);
    if (!user) return;
    const id = parseId((req.params as { id: string }).id);
    if (id === null) return reply.code(400).send({ error: 'invalid_id' });
    if (!getEventLabel(db, user.id, id)) return reply.code(404).send({ error: 'not_found' });
    const parsed = eventLabelInputSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'invalid_body', issues: parsed.error.issues });
    const label = updateEventLabel(db, user.id, id, parsed.data);
    if (!label) return reply.code(404).send({ error: 'not_found' });
    return { label: toLabelDto(label) };
  });

  // DELETE /api/event-labels/:id
  app.delete('/api/event-labels/:id', rateLimit, async (req, reply) => {
    const user = requireUser(db, req, reply);
    if (!user) return;
    const id = parseId((req.params as { id: string }).id);
    if (id === null) return reply.code(400).send({ error: 'invalid_id' });
    if (!deleteEventLabel(db, user.id, id)) return reply.code(404).send({ error: 'not_found' });
    return { ok: true };
  });

  // POST /api/guest-import
  // All-or-nothing, so a guest over the single-write rate limit can still import everything
  app.post('/api/guest-import', guestImportOptions, async (req, reply) => {
    const user = requireUser(db, req, reply);
    if (!user) return;
    const parsed = guestImportSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'invalid_body', issues: parsed.error.issues });
    const result = importGuestData(db, user.id, parsed.data);
    if (result !== 'ok') return reply.code(400).send({ error: result });
    return { ok: true };
  });
}
