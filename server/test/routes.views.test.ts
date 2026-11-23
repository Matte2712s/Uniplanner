import { createHash, randomBytes } from 'node:crypto';
import cookie from '@fastify/cookie';
import Fastify, { type FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { MAX_HIDDEN_RULES_PER_SOURCE, type HiddenRule, type View } from '@planner/shared';
import { openDb, type Db } from '../src/db/index.ts';
import { createSession, upsertUser } from '../src/db/repo.ts';
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

async function buildApp(db: Db): Promise<FastifyInstance> {
  const app = Fastify();
  await app.register(cookie);
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

const ONCE: HiddenRule = {
  kind: 'once',
  eventId: '5:100:2026-10-01T12:00:00.000Z',
  courseKey: 'MAT01|Analisi 1',
  start: '2026-10-01T12:00:00.000Z',
};
const WEEKLY: HiddenRule = {
  kind: 'weekly',
  courseKey: 'MAT01|Analisi 1',
  partition: 'Matricole pari',
  weekday: 4,
  time: '14:00',
};

function sourceWith(hidden: unknown) {
  return { sourceId: 5, courseMode: 'exclude', courses: [], hidden };
}

describe('view routes: hidden lessons', () => {
  let app: FastifyInstance | undefined;

  afterEach(async () => {
    await app?.close();
    app = undefined;
  });

  async function setup() {
    const db = openDb(':memory:');
    const server = await buildApp(db);
    app = server;
    const user = upsertUser(db, 'a', 'a@example.com', 'A');
    const cookieHeader = sessionCookieFor(db, user.id);
    const created = await server.inject(
      jsonReq('POST', '/api/views', cookieHeader, { name: 'Mine', settings: { sources: [sourceWith([])] } }),
    );
    expect(created.statusCode).toBe(200);
    const view = created.json().view as View;
    return { server, cookieHeader, view };
  }

  const listViews = (server: FastifyInstance, cookieHeader: string) =>
    server.inject({ method: 'GET', url: '/api/views', headers: { cookie: cookieHeader } });

  it('starts with no hidden rules and fills the default for a source saved without the field', async () => {
    const db = openDb(':memory:');
    const server = await buildApp(db);
    app = server;
    const user = upsertUser(db, 'a', 'a@example.com', 'A');
    const cookieHeader = sessionCookieFor(db, user.id);

    const created = await server.inject(
      jsonReq('POST', '/api/views', cookieHeader, {
        name: 'Old client',
        settings: { sources: [{ sourceId: 5, courseMode: 'exclude', courses: [] }] },
      }),
    );
    expect(created.statusCode).toBe(200);
    expect(created.json().view.settings.sources[0].hidden).toEqual([]);
    expect((await listViews(server, cookieHeader)).json().views[0].settings.sources[0].hidden).toEqual([]);
  });

  it('round-trips hidden rules through PUT /api/views/:id and GET /api/views', async () => {
    const { server, cookieHeader, view } = await setup();

    const res = await server.inject(
      jsonReq('PUT', `/api/views/${view.id}`, cookieHeader, {
        settings: { ...view.settings, sources: [sourceWith([ONCE, WEEKLY])] },
      }),
    );
    expect(res.statusCode).toBe(200);
    expect(res.json().view.settings.sources[0].hidden).toEqual([ONCE, WEEKLY]);

    const listed = (await listViews(server, cookieHeader)).json().views as View[];
    expect(listed).toHaveLength(1);
    expect(listed[0]!.settings.sources[0]!.hidden).toEqual([ONCE, WEEKLY]);
    // The rest of the source is untouched
    expect(listed[0]!.settings.sources[0]).toMatchObject({ sourceId: 5, courseMode: 'exclude', courses: [] });
  });

  it('keeps a weekly rule with a null partition', async () => {
    const { server, cookieHeader, view } = await setup();
    const rule = { ...WEEKLY, partition: null };
    const res = await server.inject(
      jsonReq('PUT', `/api/views/${view.id}`, cookieHeader, { settings: { ...view.settings, sources: [sourceWith([rule])] } }),
    );
    expect(res.statusCode).toBe(200);
    expect((await listViews(server, cookieHeader)).json().views[0].settings.sources[0].hidden).toEqual([rule]);
  });

  it('accepts exactly the per-source cap of rules', async () => {
    const { server, cookieHeader, view } = await setup();
    const rules = Array.from({ length: MAX_HIDDEN_RULES_PER_SOURCE }, (_, i) => ({ ...ONCE, eventId: `5:${i}:x` }));
    const res = await server.inject(
      jsonReq('PUT', `/api/views/${view.id}`, cookieHeader, { settings: { ...view.settings, sources: [sourceWith(rules)] } }),
    );
    expect(res.statusCode).toBe(200);
    expect(res.json().view.settings.sources[0].hidden).toHaveLength(MAX_HIDDEN_RULES_PER_SOURCE);
  });

  it('rejects invalid rules with 400 and keeps the stored ones', async () => {
    const { server, cookieHeader, view } = await setup();
    await server.inject(
      jsonReq('PUT', `/api/views/${view.id}`, cookieHeader, { settings: { ...view.settings, sources: [sourceWith([WEEKLY])] } }),
    );

    const bad: unknown[] = [
      [{ ...WEEKLY, weekday: 8 }],
      [{ ...WEEKLY, weekday: 0 }],
      [{ ...WEEKLY, time: '24:00' }],
      [{ ...WEEKLY, time: '9:00' }],
      [{ ...WEEKLY, partition: undefined }],
      [{ ...ONCE, eventId: '' }],
      [{ ...ONCE, start: 'tomorrow' }],
      [{ kind: 'daily', courseKey: 'x' }],
      'not a list',
      Array.from({ length: MAX_HIDDEN_RULES_PER_SOURCE + 1 }, (_, i) => ({ ...ONCE, eventId: `5:${i}:x` })),
    ];
    for (const hidden of bad) {
      const res = await server.inject(
        jsonReq('PUT', `/api/views/${view.id}`, cookieHeader, { settings: { ...view.settings, sources: [sourceWith(hidden)] } }),
      );
      expect(res.statusCode, JSON.stringify(hidden).slice(0, 80)).toBe(400);
      expect(res.json().error).toBe('invalid_body');
    }

    expect((await listViews(server, cookieHeader)).json().views[0].settings.sources[0].hidden).toEqual([WEEKLY]);
  });

  it('rejects invalid rules when creating a view too', async () => {
    const { server, cookieHeader } = await setup();
    const res = await server.inject(
      jsonReq('POST', '/api/views', cookieHeader, {
        name: 'Bad',
        settings: { sources: [sourceWith([{ ...WEEKLY, weekday: 8 }])] },
      }),
    );
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('invalid_body');
    expect((await listViews(server, cookieHeader)).json().views).toHaveLength(1);
  });

  it('returns the rules in GET /api/shared/:token, so the share link applies them', async () => {
    const { server, cookieHeader, view } = await setup();
    await server.inject(
      jsonReq('PUT', `/api/views/${view.id}`, cookieHeader, {
        settings: { ...view.settings, sources: [sourceWith([ONCE, WEEKLY])] },
      }),
    );
    const shared = await server.inject(jsonReq('POST', `/api/views/${view.id}/share`, cookieHeader));
    const token = shared.json().view.shareToken as string;

    // No session: a visitor opens the link
    const res = await server.inject({ method: 'GET', url: `/api/shared/${token}` });
    expect(res.statusCode).toBe(200);
    expect(res.json().settings.sources[0].hidden).toEqual([ONCE, WEEKLY]);
  });

  it('shows a rule change on the share link right away', async () => {
    const { server, cookieHeader, view } = await setup();
    const token = (await server.inject(jsonReq('POST', `/api/views/${view.id}/share`, cookieHeader))).json().view.shareToken as string;
    expect((await server.inject({ method: 'GET', url: `/api/shared/${token}` })).json().settings.sources[0].hidden).toEqual([]);

    await server.inject(
      jsonReq('PUT', `/api/views/${view.id}`, cookieHeader, { settings: { ...view.settings, sources: [sourceWith([WEEKLY])] } }),
    );
    expect((await server.inject({ method: 'GET', url: `/api/shared/${token}` })).json().settings.sources[0].hidden).toEqual([WEEKLY]);
  });
});
