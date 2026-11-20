import { createHash, randomBytes } from 'node:crypto';
import cookie from '@fastify/cookie';
import rateLimit from '@fastify/rate-limit';
import Fastify, { type FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import {
  customEventInputSchema,
  MAX_CUSTOM_EVENTS_PER_USER,
  MAX_EVENT_LABELS_PER_USER,
  type CustomEventData,
  type CustomEventDto,
  type EventLabelDto,
} from '@planner/shared';
import { openDb, type Db } from '../src/db/index.ts';
import { createCustomEvent, createEventLabel, createSession, listEventLabels, upsertUser } from '../src/db/repo.ts';
import { registerCustomEventRoutes } from '../src/routes/customEvents.ts';
import { registerSharedViewRoutes } from '../src/routes/shared.ts';
import { registerViewRoutes } from '../src/routes/views.ts';

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

function sessionCookieFor(db: Db, userId: number): string {
  const token = randomBytes(16).toString('base64url');
  createSession(db, hashToken(token), userId, Date.now() + 60_000);
  return `session=${token}`;
}

async function buildApp(db: Db, opts: { rateLimit?: boolean } = {}): Promise<FastifyInstance> {
  const app = Fastify();
  await app.register(cookie);
  // High global cap, so only a route-level override can trip it
  if (opts.rateLimit) await app.register(rateLimit, { max: 10_000, timeWindow: '1 minute' });
  registerCustomEventRoutes(app, db);
  registerViewRoutes(app, db);
  registerSharedViewRoutes(app, db);
  await app.ready();
  return app;
}

function jsonReq(method: 'POST' | 'PUT' | 'DELETE', url: string, cookieHeader: string, body?: unknown) {
  return {
    method,
    url,
    headers: { cookie: cookieHeader, ...(body !== undefined ? { 'content-type': 'application/json' } : {}) },
    payload: body !== undefined ? JSON.stringify(body) : undefined,
  } as const;
}

const onceSchedule = { kind: 'once', startDate: '2026-11-19', startTime: '10:00', endDate: '2026-11-19', endTime: '12:00' };
const weeklySchedule = {
  kind: 'weekly',
  startDate: '2026-11-16',
  slots: [{ weekday: 1, startTime: '09:00', endTime: '11:00' }],
};

function eventBody(overrides: Record<string, unknown> = {}) {
  return { title: 'Studio', timeZone: 'Europe/Rome', schedule: onceSchedule, ...overrides };
}

function parsedEvent(overrides: Record<string, unknown> = {}): CustomEventData {
  return customEventInputSchema.parse(eventBody(overrides));
}

describe('custom event routes', () => {
  let app: FastifyInstance | undefined;

  afterEach(async () => {
    await app?.close();
    app = undefined;
  });

  it('answers 401 on every route when logged out', async () => {
    const db = openDb(':memory:');
    app = await buildApp(db);
    const body = JSON.stringify(eventBody());
    const headers = { 'content-type': 'application/json' };

    const calls = [
      { method: 'GET', url: '/api/custom-events' },
      { method: 'POST', url: '/api/custom-events', headers, payload: body },
      { method: 'PUT', url: '/api/custom-events/1', headers, payload: body },
      { method: 'DELETE', url: '/api/custom-events/1' },
      { method: 'POST', url: '/api/event-labels', headers, payload: JSON.stringify({ name: 'L', color: '#ff0000' }) },
      { method: 'PUT', url: '/api/event-labels/1', headers, payload: JSON.stringify({ name: 'L', color: '#ff0000' }) },
      { method: 'DELETE', url: '/api/event-labels/1' },
    ] as const;
    for (const call of calls) {
      const res = await app.inject(call);
      expect(res.statusCode, `${call.method} ${call.url}`).toBe(401);
    }
  });

  it('creates, lists, updates and deletes events and labels', async () => {
    const db = openDb(':memory:');
    app = await buildApp(db);
    const user = upsertUser(db, 'a', 'a@example.com', 'A');
    const cookieHeader = sessionCookieFor(db, user.id);

    const labelRes = await app.inject(jsonReq('POST', '/api/event-labels', cookieHeader, { name: '  Exam ', color: '#FF0000' }));
    expect(labelRes.statusCode).toBe(200);
    const label = labelRes.json().label as EventLabelDto;
    expect(label).toEqual({ id: expect.any(Number), name: 'Exam', color: '#FF0000' });

    const createRes = await app.inject(
      jsonReq('POST', '/api/custom-events', cookieHeader, eventBody({ labelId: label.id, notes: 'Bring ID' })),
    );
    expect(createRes.statusCode).toBe(200);
    const event = createRes.json().event as CustomEventDto;
    expect(event).toMatchObject({ title: 'Studio', labelId: label.id, notes: 'Bring ID', timeZone: 'Europe/Rome' });
    expect(event).not.toHaveProperty('userId');

    const listRes = await app.inject({ method: 'GET', url: '/api/custom-events', headers: { cookie: cookieHeader } });
    expect(listRes.statusCode).toBe(200);
    expect(listRes.json()).toEqual({ events: [event], labels: [label] });

    const putRes = await app.inject(
      jsonReq('PUT', `/api/custom-events/${event.id}`, cookieHeader, eventBody({ title: 'Renamed', schedule: weeklySchedule })),
    );
    expect(putRes.statusCode).toBe(200);
    // Full replace: omitted optional fields are cleared
    expect(putRes.json().event).toMatchObject({ id: event.id, title: 'Renamed', labelId: null, notes: null });
    expect(putRes.json().event.schedule.kind).toBe('weekly');

    const labelPut = await app.inject(
      jsonReq('PUT', `/api/event-labels/${label.id}`, cookieHeader, { name: 'Exams', color: '#00ff00' }),
    );
    expect(labelPut.statusCode).toBe(200);
    expect(labelPut.json().label).toEqual({ id: label.id, name: 'Exams', color: '#00ff00' });

    const delEvent = await app.inject(jsonReq('DELETE', `/api/custom-events/${event.id}`, cookieHeader));
    expect(delEvent.statusCode).toBe(200);
    expect(delEvent.json()).toEqual({ ok: true });
    const delAgain = await app.inject(jsonReq('DELETE', `/api/custom-events/${event.id}`, cookieHeader));
    expect(delAgain.statusCode).toBe(404);

    const delLabel = await app.inject(jsonReq('DELETE', `/api/event-labels/${label.id}`, cookieHeader));
    expect(delLabel.statusCode).toBe(200);
    expect(delLabel.json()).toEqual({ ok: true });

    const finalList = await app.inject({ method: 'GET', url: '/api/custom-events', headers: { cookie: cookieHeader } });
    expect(finalList.json()).toEqual({ events: [], labels: [] });
  });

  it('only lists the requesting user data', async () => {
    const db = openDb(':memory:');
    app = await buildApp(db);
    const a = upsertUser(db, 'a', 'a@example.com', 'A');
    const b = upsertUser(db, 'b', 'b@example.com', 'B');
    createCustomEvent(db, a.id, parsedEvent({ title: 'A event' }));
    createEventLabel(db, a.id, { name: 'A label', color: '#ff0000' });

    const res = await app.inject({ method: 'GET', url: '/api/custom-events', headers: { cookie: sessionCookieFor(db, b.id) } });
    expect(res.json()).toEqual({ events: [], labels: [] });
  });

  it('answers 404 when a stranger touches another user event or label', async () => {
    const db = openDb(':memory:');
    app = await buildApp(db);
    const owner = upsertUser(db, 'a', 'a@example.com', 'A');
    const stranger = upsertUser(db, 'b', 'b@example.com', 'B');
    const cookieStranger = sessionCookieFor(db, stranger.id);
    const event = createCustomEvent(db, owner.id, parsedEvent());
    const label = createEventLabel(db, owner.id, { name: 'Mine', color: '#ff0000' });
    if (typeof event === 'string' || label === 'limit') throw new Error('setup failed');

    const putEvent = await app.inject(jsonReq('PUT', `/api/custom-events/${event.id}`, cookieStranger, eventBody({ title: 'Hijack' })));
    expect(putEvent.statusCode).toBe(404);
    const delEvent = await app.inject(jsonReq('DELETE', `/api/custom-events/${event.id}`, cookieStranger));
    expect(delEvent.statusCode).toBe(404);
    const putLabel = await app.inject(
      jsonReq('PUT', `/api/event-labels/${label.id}`, cookieStranger, { name: 'Hijack', color: '#000000' }),
    );
    expect(putLabel.statusCode).toBe(404);
    const delLabel = await app.inject(jsonReq('DELETE', `/api/event-labels/${label.id}`, cookieStranger));
    expect(delLabel.statusCode).toBe(404);

    // Nothing changed for the owner
    const list = await app.inject({ method: 'GET', url: '/api/custom-events', headers: { cookie: sessionCookieFor(db, owner.id) } });
    expect(list.json().events).toHaveLength(1);
    expect(list.json().events[0].title).toBe('Studio');
    expect(list.json().labels).toEqual([{ id: label.id, name: 'Mine', color: '#ff0000' }]);
  });

  it('rejects malformed ids', async () => {
    const db = openDb(':memory:');
    app = await buildApp(db);
    const user = upsertUser(db, 'a', 'a@example.com', 'A');
    const cookieHeader = sessionCookieFor(db, user.id);

    for (const id of ['abc', '0', '-1', '1.5']) {
      const putEvent = await app.inject(jsonReq('PUT', `/api/custom-events/${id}`, cookieHeader, eventBody()));
      expect(putEvent.statusCode, `PUT event ${id}`).toBe(400);
      expect(putEvent.json().error).toBe('invalid_id');
      const delEvent = await app.inject(jsonReq('DELETE', `/api/custom-events/${id}`, cookieHeader));
      expect(delEvent.statusCode, `DELETE event ${id}`).toBe(400);
      const putLabel = await app.inject(jsonReq('PUT', `/api/event-labels/${id}`, cookieHeader, { name: 'L', color: '#ff0000' }));
      expect(putLabel.statusCode, `PUT label ${id}`).toBe(400);
      const delLabel = await app.inject(jsonReq('DELETE', `/api/event-labels/${id}`, cookieHeader));
      expect(delLabel.statusCode, `DELETE label ${id}`).toBe(400);
    }
  });

  it('answers 400 invalid_body for bad event input', async () => {
    const db = openDb(':memory:');
    app = await buildApp(db);
    const user = upsertUser(db, 'a', 'a@example.com', 'A');
    const cookieHeader = sessionCookieFor(db, user.id);
    const existing = createCustomEvent(db, user.id, parsedEvent());
    if (typeof existing === 'string') throw new Error(existing);

    const bad: Record<string, unknown>[] = [
      eventBody({ url: 'javascript:alert(1)' }),
      eventBody({ url: 'http://example.com' }),
      // Right-to-left override
      eventBody({ title: 'Safe‮exe.txt' }),
      eventBody({ title: '   ' }),
      eventBody({ userId: 999 }),
      eventBody({ timeZone: 'Mars/Olympus' }),
      eventBody({ color: 'red' }),
      eventBody({ labelId: -1 }),
      eventBody({ schedule: { ...onceSchedule, endTime: '09:00' } }),
      eventBody({ schedule: { ...onceSchedule, startDate: '2026-02-30', endDate: '2026-02-30' } }),
      eventBody({ schedule: { kind: 'weekly', startDate: '2026-11-16', slots: [] } }),
      { timeZone: 'Europe/Rome', schedule: onceSchedule },
    ];
    for (const body of bad) {
      const post = await app.inject(jsonReq('POST', '/api/custom-events', cookieHeader, body));
      expect(post.statusCode, JSON.stringify(body)).toBe(400);
      expect(post.json().error).toBe('invalid_body');
      expect(Array.isArray(post.json().issues)).toBe(true);
      const put = await app.inject(jsonReq('PUT', `/api/custom-events/${existing.id}`, cookieHeader, body));
      expect(put.statusCode, JSON.stringify(body)).toBe(400);
      expect(put.json().error).toBe('invalid_body');
    }

    const nonObject = await app.inject(jsonReq('POST', '/api/custom-events', cookieHeader, [1, 2]));
    expect(nonObject.statusCode).toBe(400);
    expect(nonObject.json().error).toBe('invalid_body');

    // The failed updates left the stored event untouched
    const list = await app.inject({ method: 'GET', url: '/api/custom-events', headers: { cookie: cookieHeader } });
    expect(list.json().events).toEqual([existing]);
  });

  it('answers 400 invalid_body for bad label input', async () => {
    const db = openDb(':memory:');
    app = await buildApp(db);
    const user = upsertUser(db, 'a', 'a@example.com', 'A');
    const cookieHeader = sessionCookieFor(db, user.id);
    const label = createEventLabel(db, user.id, { name: 'Ok', color: '#ff0000' });
    if (label === 'limit') throw new Error('unexpected limit');

    const bad: Record<string, unknown>[] = [
      { name: 'L', color: 'red' },
      { name: '', color: '#ff0000' },
      { name: 'x'.repeat(41), color: '#ff0000' },
      { name: 'Bidi‮', color: '#ff0000' },
      { name: 'L', color: '#ff0000', userId: 1 },
      { color: '#ff0000' },
    ];
    for (const body of bad) {
      const post = await app.inject(jsonReq('POST', '/api/event-labels', cookieHeader, body));
      expect(post.statusCode, JSON.stringify(body)).toBe(400);
      expect(post.json().error).toBe('invalid_body');
      const put = await app.inject(jsonReq('PUT', `/api/event-labels/${label.id}`, cookieHeader, body));
      expect(put.statusCode, JSON.stringify(body)).toBe(400);
      expect(put.json().error).toBe('invalid_body');
    }
    expect(listEventLabels(db, user.id)).toHaveLength(1);
  });

  it('answers 400 invalid_label for a label owned by someone else', async () => {
    const db = openDb(':memory:');
    app = await buildApp(db);
    const a = upsertUser(db, 'a', 'a@example.com', 'A');
    const b = upsertUser(db, 'b', 'b@example.com', 'B');
    const cookieA = sessionCookieFor(db, a.id);
    const foreign = createEventLabel(db, b.id, { name: 'Theirs', color: '#00ff00' });
    if (foreign === 'limit') throw new Error('unexpected limit');
    const own = createCustomEvent(db, a.id, parsedEvent());
    if (typeof own === 'string') throw new Error(own);

    const post = await app.inject(jsonReq('POST', '/api/custom-events', cookieA, eventBody({ labelId: foreign.id })));
    expect(post.statusCode).toBe(400);
    expect(post.json()).toEqual({ error: 'invalid_label' });

    const put = await app.inject(jsonReq('PUT', `/api/custom-events/${own.id}`, cookieA, eventBody({ labelId: foreign.id })));
    expect(put.statusCode).toBe(400);
    expect(put.json()).toEqual({ error: 'invalid_label' });

    const missing = await app.inject(jsonReq('POST', '/api/custom-events', cookieA, eventBody({ labelId: 424242 })));
    expect(missing.statusCode).toBe(400);
    expect(missing.json()).toEqual({ error: 'invalid_label' });
  });

  it('enforces the per-user event cap', async () => {
    const db = openDb(':memory:');
    app = await buildApp(db);
    const user = upsertUser(db, 'a', 'a@example.com', 'A');
    const cookieHeader = sessionCookieFor(db, user.id);
    const event = parsedEvent();
    for (let i = 0; i < MAX_CUSTOM_EVENTS_PER_USER; i++) createCustomEvent(db, user.id, event);

    const res = await app.inject(jsonReq('POST', '/api/custom-events', cookieHeader, eventBody()));
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: 'too_many_custom_events' });
  });

  it('enforces the per-user label cap', async () => {
    const db = openDb(':memory:');
    app = await buildApp(db);
    const user = upsertUser(db, 'a', 'a@example.com', 'A');
    const cookieHeader = sessionCookieFor(db, user.id);
    for (let i = 0; i < MAX_EVENT_LABELS_PER_USER; i++) createEventLabel(db, user.id, { name: `L${i}`, color: '#ff0000' });

    const res = await app.inject(jsonReq('POST', '/api/event-labels', cookieHeader, { name: 'One too many', color: '#ff0000' }));
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: 'too_many_event_labels' });
  });

  it('answers 413 for a body over 16 KB', async () => {
    const db = openDb(':memory:');
    app = await buildApp(db);
    const user = upsertUser(db, 'a', 'a@example.com', 'A');
    const cookieHeader = sessionCookieFor(db, user.id);
    const event = createCustomEvent(db, user.id, parsedEvent());
    if (typeof event === 'string') throw new Error(event);
    const huge = eventBody({ notes: 'x'.repeat(20_000) });

    const post = await app.inject(jsonReq('POST', '/api/custom-events', cookieHeader, huge));
    expect(post.statusCode).toBe(413);
    const put = await app.inject(jsonReq('PUT', `/api/custom-events/${event.id}`, cookieHeader, huge));
    expect(put.statusCode).toBe(413);
    const label = await app.inject(jsonReq('POST', '/api/event-labels', cookieHeader, { name: 'x'.repeat(20_000), color: '#ff0000' }));
    expect(label.statusCode).toBe(413);

    const list = await app.inject({ method: 'GET', url: '/api/custom-events', headers: { cookie: cookieHeader } });
    expect(list.json().events).toHaveLength(1);
  });

  it('applies a route-level rate limit of 60 requests per minute', async () => {
    const db = openDb(':memory:');
    app = await buildApp(db, { rateLimit: true });
    const user = upsertUser(db, 'a', 'a@example.com', 'A');
    const cookieHeader = sessionCookieFor(db, user.id);

    for (let i = 0; i < 60; i++) {
      const res = await app.inject(jsonReq('DELETE', '/api/custom-events/1', cookieHeader));
      expect(res.statusCode).toBe(404);
    }
    const limited = await app.inject(jsonReq('DELETE', '/api/custom-events/1', cookieHeader));
    expect(limited.statusCode).toBe(429);

    // Limits are per route
    const other = await app.inject({ method: 'GET', url: '/api/custom-events', headers: { cookie: cookieHeader } });
    expect(other.statusCode).toBe(200);
  });

  it('prunes a deleted label from view settings and unlabels its events', async () => {
    const db = openDb(':memory:');
    app = await buildApp(db);
    const user = upsertUser(db, 'a', 'a@example.com', 'A');
    const cookieHeader = sessionCookieFor(db, user.id);

    const label = (await app.inject(jsonReq('POST', '/api/event-labels', cookieHeader, { name: 'Gone', color: '#ff0000' }))).json()
      .label as EventLabelDto;
    const event = (await app.inject(jsonReq('POST', '/api/custom-events', cookieHeader, eventBody({ labelId: label.id })))).json()
      .event as CustomEventDto;
    const view = (
      await app.inject(
        jsonReq('POST', '/api/views', cookieHeader, {
          name: 'V',
          settings: { customEvents: { show: true, hiddenLabels: [label.id], shareInLink: false } },
        }),
      )
    ).json().view as { id: number };

    const del = await app.inject(jsonReq('DELETE', `/api/event-labels/${label.id}`, cookieHeader));
    expect(del.statusCode).toBe(200);

    const views = await app.inject({ method: 'GET', url: '/api/views', headers: { cookie: cookieHeader } });
    const stored = views.json().views.find((v: { id: number }) => v.id === view.id);
    expect(stored.settings.customEvents.hiddenLabels).toEqual([]);

    const list = await app.inject({ method: 'GET', url: '/api/custom-events', headers: { cookie: cookieHeader } });
    expect(list.json().events).toEqual([expect.objectContaining({ id: event.id, labelId: null })]);
    expect(list.json().labels).toEqual([]);
  });

  it('returns customEvents defaults for views stored before the feature existed', async () => {
    const db = openDb(':memory:');
    app = await buildApp(db);
    const user = upsertUser(db, 'a', 'a@example.com', 'A');
    const cookieHeader = sessionCookieFor(db, user.id);
    db.prepare('INSERT INTO views (user_id, name, position, settings) VALUES (?, ?, 0, ?)').run(
      user.id,
      'Legacy',
      JSON.stringify({ sources: [], calendarMode: 'week', showCancelled: false, colors: {} }),
    );

    const res = await app.inject({ method: 'GET', url: '/api/views', headers: { cookie: cookieHeader } });
    expect(res.json().views[0].settings.customEvents).toEqual({ show: true, hiddenLabels: [], shareInLink: false });
  });
});

describe('shared custom events', () => {
  let app: FastifyInstance | undefined;

  afterEach(async () => {
    await app?.close();
    app = undefined;
  });

  /** An owner with a shared view, an unlabeled event, a visible-label event, a hidden-label event and a weekly one. */
  async function setup(db: Db, customEvents: { show: boolean; hiddenLabels: 'hide-a' | 'none'; shareInLink: boolean }) {
    const server = (app = await buildApp(db));
    const owner = upsertUser(db, 'owner', 'owner@example.com', 'Owner');
    const cookieHeader = sessionCookieFor(db, owner.id);
    // Filler labels are removed below, so the real label ids do not start at 1
    const fillerLabels = [1, 2, 3].map(() => createEventLabel(db, owner.id, { name: 'Filler', color: '#999999' }));
    const labelA = createEventLabel(db, owner.id, { name: 'Hidden', color: '#ff0000' });
    const labelB = createEventLabel(db, owner.id, { name: 'Visible', color: '#00ff00' });
    createEventLabel(db, owner.id, { name: 'Unused', color: '#0000ff' });
    if (labelA === 'limit' || labelB === 'limit') throw new Error('unexpected limit');
    for (const filler of fillerLabels) {
      if (filler !== 'limit') await server.inject(jsonReq('DELETE', `/api/event-labels/${filler.id}`, cookieHeader));
    }

    // Fillers are removed once the real events exist, so the real ids do not start at 1
    const fillers: number[] = [];
    for (let i = 0; i < 3; i++) {
      const filler = createCustomEvent(db, owner.id, parsedEvent({ title: 'Filler' }));
      if (typeof filler === 'string') throw new Error(filler);
      fillers.push(filler.id);
    }

    const created: CustomEventDto[] = [];
    const bodies = [
      eventBody({ title: 'Plain', notes: 'SECRET-NOTE', url: 'https://example.com/secret-link', location: 'Aula 1', color: '#123456' }),
      eventBody({ title: 'Hidden one', labelId: labelA.id }),
      eventBody({ title: 'Visible one', labelId: labelB.id, notes: 'SECRET-NOTE-2' }),
      eventBody({ title: 'Weekly', schedule: weeklySchedule }),
    ];
    for (const body of bodies) {
      const res = await server.inject(jsonReq('POST', '/api/custom-events', cookieHeader, body));
      created.push(res.json().event as CustomEventDto);
    }
    for (const id of fillers) await server.inject(jsonReq('DELETE', `/api/custom-events/${id}`, cookieHeader));

    const view = (
      await server.inject(
        jsonReq('POST', '/api/views', cookieHeader, {
          name: 'Shared',
          settings: {
            customEvents: {
              show: customEvents.show,
              hiddenLabels: customEvents.hiddenLabels === 'hide-a' ? [labelA.id] : [],
              shareInLink: customEvents.shareInLink,
            },
          },
        }),
      )
    ).json().view as { id: number };
    const token = (await server.inject(jsonReq('POST', `/api/views/${view.id}/share`, cookieHeader))).json().view.shareToken as string;
    return { owner, cookieHeader, labelA, labelB, created, view, token };
  }

  const getShared = (server: FastifyInstance, token: string) =>
    server.inject({ method: 'GET', url: `/api/shared/${token}/custom-events` });

  it('answers 404 for an unknown token', async () => {
    const db = openDb(':memory:');
    app = await buildApp(db);
    const res = await getShared(app, 'no-such-token');
    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ error: 'not_found' });
  });

  it('shares nothing by default, even for a shared view', async () => {
    const db = openDb(':memory:');
    const { token } = await setup(db, { show: true, hiddenLabels: 'none', shareInLink: false });

    const res = await getShared(app!, token);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ events: [], labels: [] });
  });

  it('shares nothing when the view hides custom events altogether', async () => {
    const db = openDb(':memory:');
    const { token } = await setup(db, { show: false, hiddenLabels: 'none', shareInLink: true });

    const res = await getShared(app!, token);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ events: [], labels: [] });
  });

  it('shares renumbered, redacted events without hidden labels once shareInLink is on', async () => {
    const db = openDb(':memory:');
    const { token, labelA, labelB, created } = await setup(db, { show: true, hiddenLabels: 'hide-a', shareInLink: true });

    // No session: the link alone grants access
    const res = await getShared(app!, token);
    expect(res.statusCode).toBe(200);
    const body = res.json() as { events: Record<string, unknown>[]; labels: unknown[] };

    expect(body.events.map((e) => e.title)).toEqual(['Plain', 'Visible one', 'Weekly']);
    expect(body.events.map((e) => e.id)).toEqual([1, 2, 3]);
    // Real ids are not leaked
    expect(created.map((e) => e.id)).not.toContain(1);
    expect(body.events.map((e) => e.id)).not.toEqual(created.filter((e) => e.title !== 'Hidden one').map((e) => e.id));
    expect(body.events[0]).toEqual({
      id: 1,
      labelId: null,
      title: 'Plain',
      location: 'Aula 1',
      color: '#123456',
      timeZone: 'Europe/Rome',
      schedule: onceSchedule,
    });
    // Labels are renumbered too: the visible label is the first one in use
    expect(labelB.id).not.toBe(1);
    expect(body.events[1]).toMatchObject({ labelId: 1 });
    expect(body.events[2]).toMatchObject({ labelId: null, schedule: { kind: 'weekly' } });

    // Only labels that the returned events use
    expect(body.labels).toEqual([{ id: 1, name: 'Visible', color: '#00ff00' }]);
    expect(labelA.id).not.toBe(1);

    for (const event of body.events) {
      expect(Object.keys(event).sort()).toEqual(['color', 'id', 'labelId', 'location', 'schedule', 'timeZone', 'title']);
    }

    // The raw payload carries none of the withheld data
    for (const needle of ['notes', 'url', 'updatedAt', 'userId', 'user_id', 'SECRET-NOTE', 'secret-link', 'Hidden one', 'Hidden"']) {
      expect(res.payload, needle).not.toContain(needle);
    }
  });

  it('shares every label-carrying and unlabeled event when no label is hidden', async () => {
    const db = openDb(':memory:');
    const { token, labelA, labelB } = await setup(db, { show: true, hiddenLabels: 'none', shareInLink: true });
    expect(Math.min(labelA.id, labelB.id)).toBeGreaterThan(2);

    const res = await getShared(app!, token);
    const body = res.json() as {
      events: { title: string; id: number; labelId: number | null }[];
      labels: { id: number; name: string }[];
    };
    expect(body.events.map((e) => e.title)).toEqual(['Plain', 'Hidden one', 'Visible one', 'Weekly']);
    expect(body.events.map((e) => e.id)).toEqual([1, 2, 3, 4]);
    // Label ids are 1..n in label id order, and events point at those
    expect(body.labels).toEqual([
      { id: 1, name: 'Hidden', color: '#ff0000' },
      { id: 2, name: 'Visible', color: '#00ff00' },
    ]);
    expect(body.events.map((e) => e.labelId)).toEqual([null, 1, 2, null]);
  });

  it('blanks hiddenLabels in the shared view settings but keeps everything else', async () => {
    const db = openDb(':memory:');
    const { token, labelA } = await setup(db, { show: true, hiddenLabels: 'hide-a', shareInLink: true });

    const res = await app!.inject({ method: 'GET', url: `/api/shared/${token}` });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { name: string; settings: { customEvents: unknown; calendarMode: string; sources: unknown[] } };
    expect(body.name).toBe('Shared');
    expect(body.settings.customEvents).toEqual({ show: true, hiddenLabels: [], shareInLink: true });
    expect(body.settings.calendarMode).toBe('week');
    expect(body.settings.sources).toEqual([]);
    // Real label id is nowhere in the payload
    expect(res.payload).not.toContain(`"hiddenLabels":[${labelA.id}`);

    // The hidden label's event is still withheld by the custom-events endpoint
    const events = (await getShared(app!, token)).json() as { events: { title: string }[] };
    expect(events.events.map((e) => e.title)).not.toContain('Hidden one');
  });

  it('follows later setting changes and stops once the link is revoked', async () => {
    const db = openDb(':memory:');
    const { token, view, cookieHeader, labelA } = await setup(db, { show: true, hiddenLabels: 'none', shareInLink: true });
    const server = app!;

    const hide = await server.inject(
      jsonReq('PUT', `/api/views/${view.id}`, cookieHeader, {
        settings: { customEvents: { show: true, hiddenLabels: [labelA.id], shareInLink: true } },
      }),
    );
    expect(hide.statusCode).toBe(200);
    const afterHide = (await getShared(server, token)).json() as { events: { title: string }[] };
    expect(afterHide.events.map((e) => e.title)).toEqual(['Plain', 'Visible one', 'Weekly']);

    const revoke = await server.inject(jsonReq('DELETE', `/api/views/${view.id}/share`, cookieHeader));
    expect(revoke.statusCode).toBe(200);
    expect((await getShared(server, token)).statusCode).toBe(404);
  });

  it('applies a route-level rate limit of 60 requests per minute', async () => {
    const db = openDb(':memory:');
    app = await buildApp(db, { rateLimit: true });

    for (let i = 0; i < 60; i++) expect((await getShared(app, 'nope')).statusCode).toBe(404);
    expect((await getShared(app, 'nope')).statusCode).toBe(429);
  });
});
