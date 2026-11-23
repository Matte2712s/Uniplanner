import { createHash, randomBytes } from 'node:crypto';
import cookie from '@fastify/cookie';
import rateLimit from '@fastify/rate-limit';
import Fastify, { type FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import {
  customEventInputSchema,
  defaultViewSettings,
  MAX_CUSTOM_EVENTS_PER_USER,
  MAX_EVENT_LABELS_PER_USER,
  MAX_VIEWS_PER_USER,
} from '@planner/shared';
import { openDb, type Db } from '../src/db/index.ts';
import {
  createCustomEvent,
  createEventLabel,
  createSession,
  createView,
  listCustomEvents,
  listEventLabels,
  listViews,
  upsertUser,
} from '../src/db/repo.ts';
import { registerCustomEventRoutes } from '../src/routes/customEvents.ts';

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
  // High global cap, so only the route-level override can trip it
  if (opts.rateLimit) await app.register(rateLimit, { max: 10_000, timeWindow: '1 minute' });
  registerCustomEventRoutes(app, db);
  await app.ready();
  return app;
}

function importReq(cookieHeader: string | undefined, body: unknown) {
  return {
    method: 'POST',
    url: '/api/guest-import',
    headers: { ...(cookieHeader ? { cookie: cookieHeader } : {}), 'content-type': 'application/json' },
    payload: JSON.stringify(body),
  } as const;
}

const onceSchedule = { kind: 'once', startDate: '2026-11-19', startTime: '10:00', endDate: '2026-11-19', endTime: '12:00' };

function eventInput(title: string, labelId: number | null = null) {
  return { title, timeZone: 'Europe/Rome', schedule: onceSchedule, labelId };
}

function parsedEvent(title = 'Existing') {
  return customEventInputSchema.parse(eventInput(title));
}

function viewInput(name: string, hiddenLabels: number[] = []) {
  return { name, settings: { customEvents: { show: true, hiddenLabels, shareInLink: false } } };
}

function counts(db: Db, userId: number) {
  return {
    labels: listEventLabels(db, userId).length,
    events: listCustomEvents(db, userId).length,
    views: listViews(db, userId).length,
  };
}

describe('POST /api/guest-import', () => {
  let app: FastifyInstance | undefined;

  afterEach(async () => {
    await app?.close();
    app = undefined;
  });

  it('answers 401 when logged out', async () => {
    const db = openDb(':memory:');
    app = await buildApp(db);
    const res = await app.inject(importReq(undefined, { labels: [], events: [], views: [] }));
    expect(res.statusCode).toBe(401);
  });

  it('imports a full guest account in one request, remapping label refs', async () => {
    const db = openDb(':memory:');
    app = await buildApp(db);
    const user = upsertUser(db, 'a', 'a@example.com', 'A');
    const other = upsertUser(db, 'b', 'b@example.com', 'B');
    const cookieHeader = sessionCookieFor(db, user.id);

    // Existing rows push the new ids away from the guest's refs
    const existingLabel = createEventLabel(db, user.id, { name: 'Existing', color: '#999999' });
    if (existingLabel === 'limit') throw new Error('unexpected limit');
    createView(db, user.id, 'Existing view', defaultViewSettings());
    createCustomEvent(db, other.id, parsedEvent('Other event'));
    createEventLabel(db, other.id, { name: 'Other label', color: '#999999' });
    createView(db, other.id, 'Other view', defaultViewSettings());
    const otherBefore = counts(db, other.id);

    const refExam = 101;
    const refLab = 202;
    const refUnknown = 999;
    const events = Array.from({ length: MAX_CUSTOM_EVENTS_PER_USER }, (_, i) => {
      const labelId = [refExam, refLab, refUnknown, null][i % 4] ?? null;
      return eventInput(`E${i}`, labelId);
    });
    const res = await app.inject(
      importReq(cookieHeader, {
        labels: [
          { ref: refExam, name: 'Exam', color: '#ff0000' },
          { ref: refLab, name: 'Lab', color: '#00ff00' },
        ],
        events,
        views: [viewInput('Guest one', [refExam, refUnknown, refExam]), viewInput('Guest two', [refLab, refExam])],
      }),
    );
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });

    const labels = listEventLabels(db, user.id);
    expect(labels.map((l) => l.name)).toEqual(['Existing', 'Exam', 'Lab']);
    const examId = labels.find((l) => l.name === 'Exam')!.id;
    const labId = labels.find((l) => l.name === 'Lab')!.id;
    expect(examId).not.toBe(refExam);
    expect(labId).not.toBe(refLab);

    const stored = listCustomEvents(db, user.id);
    expect(stored).toHaveLength(MAX_CUSTOM_EVENTS_PER_USER);
    // Import order is preserved, and an unknown ref becomes "no label"
    expect(stored.map((e) => e.title)).toEqual(events.map((e) => e.title));
    stored.forEach((event, i) => {
      expect(event.labelId, event.title).toBe([examId, labId, null, null][i % 4]);
    });

    const views = listViews(db, user.id);
    expect(views.map((v) => [v.name, v.position])).toEqual([
      ['Existing view', 0],
      ['Guest one', 1],
      ['Guest two', 2],
    ]);
    // Refs are remapped, unknown ones dropped, repeats collapsed, order kept
    expect(views[1]!.settings.customEvents.hiddenLabels).toEqual([examId]);
    expect(views[2]!.settings.customEvents.hiddenLabels).toEqual([labId, examId]);

    // Nothing leaked into anyone else's account
    expect(counts(db, other.id)).toEqual(otherBefore);
    expect(listCustomEvents(db, other.id).map((e) => e.title)).toEqual(['Other event']);
  });

  it('keeps the hidden-lesson rules of a guest view', async () => {
    const db = openDb(':memory:');
    app = await buildApp(db);
    const user = upsertUser(db, 'a', 'a@example.com', 'A');
    const cookieHeader = sessionCookieFor(db, user.id);
    const once = { kind: 'once', eventId: '3:100:2026-10-01T12:00:00.000Z', courseKey: 'MAT01|Analisi 1', start: '2026-10-01T12:00:00.000Z' };
    const weekly = { kind: 'weekly', courseKey: 'MAT01|Analisi 1', partition: null, weekday: 4, time: '14:00' };
    const hiddenView = (name: string, hidden: unknown[]) => ({
      name,
      settings: { sources: [{ sourceId: 3, courseMode: 'exclude', courses: [], hidden }] },
    });

    const res = await app.inject(
      importReq(cookieHeader, {
        labels: [],
        events: [],
        // A view saved before the feature has no hidden field at all
        views: [
          hiddenView('With rules', [once, weekly]),
          { name: 'Old', settings: { sources: [{ sourceId: 3, courseMode: 'exclude', courses: [] }] } },
        ],
      }),
    );
    expect(res.statusCode).toBe(200);

    const views = listViews(db, user.id);
    expect(views.map((v) => v.name)).toEqual(['With rules', 'Old']);
    expect(views[0]!.settings.sources[0]!.hidden).toEqual([once, weekly]);
    expect(views[1]!.settings.sources[0]!.hidden).toEqual([]);

    // A bad rule fails the whole import
    const bad = await app.inject(
      importReq(cookieHeader, { labels: [], events: [], views: [hiddenView('Bad', [{ ...weekly, weekday: 8 }])] }),
    );
    expect(bad.statusCode).toBe(400);
    expect(bad.json().error).toBe('invalid_body');
    expect(listViews(db, user.id)).toHaveLength(2);
  });

  it('accepts a request larger than the single-event body limit', async () => {
    const db = openDb(':memory:');
    app = await buildApp(db);
    const user = upsertUser(db, 'a', 'a@example.com', 'A');
    const body = {
      labels: [],
      events: Array.from({ length: 100 }, (_, i) => ({ ...eventInput(`E${i}`), notes: 'n'.repeat(500) })),
      views: [],
    };
    expect(JSON.stringify(body).length).toBeGreaterThan(16384);

    const res = await app.inject(importReq(sessionCookieFor(db, user.id), body));
    expect(res.statusCode).toBe(200);
    expect(counts(db, user.id).events).toBe(100);
  });

  it('imports up to the exact remaining capacity', async () => {
    const db = openDb(':memory:');
    app = await buildApp(db);
    const user = upsertUser(db, 'a', 'a@example.com', 'A');
    for (let i = 0; i < 150; i++) createCustomEvent(db, user.id, parsedEvent());

    const res = await app.inject(
      importReq(sessionCookieFor(db, user.id), {
        labels: [],
        events: Array.from({ length: 50 }, (_, i) => eventInput(`E${i}`)),
        views: [],
      }),
    );
    expect(res.statusCode).toBe(200);
    expect(counts(db, user.id).events).toBe(MAX_CUSTOM_EVENTS_PER_USER);
  });

  it('rejects an import that would exceed the event cap and writes nothing', async () => {
    const db = openDb(':memory:');
    app = await buildApp(db);
    const user = upsertUser(db, 'a', 'a@example.com', 'A');
    const cookieHeader = sessionCookieFor(db, user.id);
    for (let i = 0; i < 150; i++) createCustomEvent(db, user.id, parsedEvent());
    const before = counts(db, user.id);

    const res = await app.inject(
      importReq(cookieHeader, {
        labels: [{ ref: 1, name: 'Would be new', color: '#ff0000' }],
        events: Array.from({ length: 60 }, (_, i) => eventInput(`E${i}`, 1)),
        views: [viewInput('Would be new', [1])],
      }),
    );
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: 'too_many_custom_events' });
    expect(counts(db, user.id)).toEqual(before);
  });

  it('rejects an import that would exceed the label cap and writes nothing', async () => {
    const db = openDb(':memory:');
    app = await buildApp(db);
    const user = upsertUser(db, 'a', 'a@example.com', 'A');
    const cookieHeader = sessionCookieFor(db, user.id);
    for (let i = 0; i < 20; i++) createEventLabel(db, user.id, { name: `L${i}`, color: '#ff0000' });
    const before = counts(db, user.id);

    const res = await app.inject(
      importReq(cookieHeader, {
        labels: Array.from({ length: MAX_EVENT_LABELS_PER_USER - 19 }, (_, i) => ({ ref: i + 1, name: `N${i}`, color: '#00ff00' })),
        events: [eventInput('Would be new')],
        views: [viewInput('Would be new')],
      }),
    );
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: 'too_many_event_labels' });
    expect(counts(db, user.id)).toEqual(before);
  });

  it('rejects an import that would exceed the view cap and writes nothing', async () => {
    const db = openDb(':memory:');
    app = await buildApp(db);
    const user = upsertUser(db, 'a', 'a@example.com', 'A');
    const cookieHeader = sessionCookieFor(db, user.id);
    for (let i = 0; i < MAX_VIEWS_PER_USER - 5; i++) createView(db, user.id, `V${i}`, defaultViewSettings());
    const before = counts(db, user.id);

    const res = await app.inject(
      importReq(cookieHeader, {
        labels: [{ ref: 1, name: 'Would be new', color: '#ff0000' }],
        events: [eventInput('Would be new', 1)],
        views: Array.from({ length: 6 }, (_, i) => viewInput(`G${i}`)),
      }),
    );
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: 'too_many_views' });
    expect(counts(db, user.id)).toEqual(before);
  });

  it('answers 400 invalid_body for malformed imports and writes nothing', async () => {
    const db = openDb(':memory:');
    app = await buildApp(db);
    const user = upsertUser(db, 'a', 'a@example.com', 'A');
    const cookieHeader = sessionCookieFor(db, user.id);

    const valid = { labels: [{ ref: 1, name: 'L', color: '#ff0000' }], events: [eventInput('Ok', 1)], views: [viewInput('V', [1])] };
    const bad: unknown[] = [
      // Duplicate ref
      { ...valid, labels: [valid.labels[0], { ref: 1, name: 'Again', color: '#00ff00' }] },
      // Bad event inside an otherwise fine batch
      { ...valid, events: [eventInput('Ok', 1), { ...eventInput('Bad'), url: 'javascript:alert(1)' }] },
      { ...valid, events: [{ ...eventInput('Bad'), userId: 5 }] },
      { ...valid, labels: [{ ref: 1, name: 'L', color: 'red' }] },
      { ...valid, labels: [{ ref: 0, name: 'L', color: '#ff0000' }] },
      { ...valid, views: [{ name: '', settings: {} }] },
      { ...valid, extra: true },
      { labels: [], events: [] },
      // Over the per-batch caps
      { ...valid, events: Array.from({ length: MAX_CUSTOM_EVENTS_PER_USER + 1 }, (_, i) => eventInput(`E${i}`)) },
      { ...valid, labels: Array.from({ length: MAX_EVENT_LABELS_PER_USER + 1 }, (_, i) => ({ ref: i + 1, name: `L${i}`, color: '#ff0000' })) },
      { ...valid, views: Array.from({ length: MAX_VIEWS_PER_USER + 1 }, (_, i) => viewInput(`V${i}`)) },
    ];
    for (const body of bad) {
      const res = await app.inject(importReq(cookieHeader, body));
      expect(res.statusCode, JSON.stringify(body).slice(0, 120)).toBe(400);
      expect(res.json().error).toBe('invalid_body');
      expect(Array.isArray(res.json().issues)).toBe(true);
    }
    expect(counts(db, user.id)).toEqual({ labels: 0, events: 0, views: 0 });
  });

  it('applies a route-level rate limit of 5 requests per minute', async () => {
    const db = openDb(':memory:');
    app = await buildApp(db, { rateLimit: true });
    const user = upsertUser(db, 'a', 'a@example.com', 'A');
    const cookieHeader = sessionCookieFor(db, user.id);

    for (let i = 0; i < 5; i++) {
      const res = await app.inject(importReq(cookieHeader, { labels: [], events: [], views: [] }));
      expect(res.statusCode).toBe(200);
    }
    const limited = await app.inject(importReq(cookieHeader, { labels: [], events: [], views: [] }));
    expect(limited.statusCode).toBe(429);
  });
});
