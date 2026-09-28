import { createHash, randomBytes } from 'node:crypto';
import cookie from '@fastify/cookie';
import Fastify, { type FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { openDb, type Db } from '../src/db/index.ts';
import { createSession, getSourceById, insertSource, upsertUser } from '../src/db/repo.ts';

const getEventsForSourceMock = vi.fn();
vi.mock('../src/cineca/service.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/cineca/service.ts')>();
  return { ...actual, getEventsForSource: getEventsForSourceMock };
});

// registerAdminRoutes/registerSourceRoutes both import cineca/service.ts, so
// they must load after the mock above via dynamic import - a static import
// here would be hoisted ahead of the getEventsForSourceMock declaration.
const { registerAdminRoutes } = await import('../src/routes/admin.ts');
const { registerSourceRoutes } = await import('../src/routes/sources.ts');
const { SourceUnavailableError } = await import('../src/cineca/service.ts');

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
  registerAdminRoutes(app, db);
  registerSourceRoutes(app, db);
  await app.ready();
  return app;
}

function jsonReq(method: 'GET' | 'POST', url: string, cookieHeader?: string, body?: unknown) {
  return {
    method,
    url,
    headers: { ...(cookieHeader ? { cookie: cookieHeader } : {}), ...(body !== undefined ? { 'content-type': 'application/json' } : {}) },
    payload: body !== undefined ? JSON.stringify(body) : undefined,
  } as const;
}

function customSource(db: Db, creatorId: number | null, linkId: string) {
  return insertSource(db, {
    kind: 'custom',
    host: 'unito.prod.up.cineca.it',
    link_calendario_id: linkId,
    title: 'Test calendar',
    title_en: null,
    created_by: creatorId,
  });
}

describe('admin routes', () => {
  let app: FastifyInstance | undefined;

  beforeEach(() => {
    getEventsForSourceMock.mockReset();
  });

  afterEach(async () => {
    await app?.close();
    app = undefined;
  });

  it('rejects an anonymous request with 401', async () => {
    const db = openDb(':memory:');
    app = await buildApp(db);
    const res = await app.inject(jsonReq('GET', '/api/admin/overview'));
    expect(res.statusCode).toBe(401);
  });

  it('rejects a logged-in non-admin with 403', async () => {
    const db = openDb(':memory:');
    app = await buildApp(db);
    const user = upsertUser(db, 'a', 'someone@example.com', 'Someone');
    const cookieHeader = sessionCookieFor(db, user.id);
    const res = await app.inject(jsonReq('GET', '/api/admin/overview', cookieHeader));
    expect(res.statusCode).toBe(403);
  });

  it('allows the configured admin email case-insensitively, and returns stats with no leaked columns', async () => {
    const db = openDb(':memory:');
    app = await buildApp(db);
    upsertUser(db, 'x', 'someone@example.com', 'Someone');
    // vitest.config.ts fixes ADMIN_EMAILS=admin@example.com; mixed case here proves the match is case-insensitive.
    const admin = upsertUser(db, 'admin', 'Admin@Example.com', 'Admin');
    const cookieHeader = sessionCookieFor(db, admin.id);

    const res = await app.inject(jsonReq('GET', '/api/admin/overview', cookieHeader));
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      stats: { userCount: number; activeSessionCount: number };
      users: Record<string, unknown>[];
      customSources: unknown[];
      defaultSources: unknown[];
      existingPrograms: string[];
    };
    expect(body.stats.userCount).toBe(2);
    expect(body.stats.activeSessionCount).toBe(1);
    expect(body.customSources).toEqual([]);
    expect(body.defaultSources).toEqual([]);
    expect(body.existingPrograms).toEqual([]);
    expect(body.users).toHaveLength(2);
    for (const u of body.users) {
      expect(Object.keys(u).sort()).toEqual(
        ['id', 'email', 'name', 'createdAt', 'pictureUrl', 'viewCount', 'customSourceCount'].sort(),
      );
    }
  });

  it('promote: a non-admin gets 403 and the source kind is left unchanged', async () => {
    const db = openDb(':memory:');
    app = await buildApp(db);
    const creator = upsertUser(db, 'c', 'creator@example.com', 'Creator');
    const source = customSource(db, creator.id, '613b9237d969e100173d4110');
    const nonAdmin = upsertUser(db, 'n', 'nonadmin@example.com', 'Non Admin');
    const cookieHeader = sessionCookieFor(db, nonAdmin.id);

    const res = await app.inject(
      jsonReq('POST', `/api/admin/sources/${source.id}/promote`, cookieHeader, { program: 'Informatica' }),
    );
    expect(res.statusCode).toBe(403);
    expect(getSourceById(db, source.id)!.kind).toBe('custom');
  });

  it('promote: an admin can promote a custom source, and it then appears under its program for another user', async () => {
    const db = openDb(':memory:');
    app = await buildApp(db);
    const creator = upsertUser(db, 'c', 'creator@example.com', 'Creator');
    const source = customSource(db, creator.id, '613b9237d969e100173d4110');
    const admin = upsertUser(db, 'admin', 'admin@example.com', 'Admin');
    const adminCookie = sessionCookieFor(db, admin.id);

    const promoteRes = await app.inject(
      jsonReq('POST', `/api/admin/sources/${source.id}/promote`, adminCookie, { program: 'Informatica' }),
    );
    expect(promoteRes.statusCode).toBe(200);
    expect(promoteRes.json()).toEqual({ ok: true });
    expect(getSourceById(db, source.id)!.kind).toBe('default');

    const other = upsertUser(db, 'o', 'other@example.com', 'Other');
    const otherCookie = sessionCookieFor(db, other.id);
    const sourcesRes = await app.inject(jsonReq('GET', '/api/sources', otherCookie));
    const body = sourcesRes.json() as { programs: { program: string; sources: unknown[] }[] };
    expect(body.programs).toHaveLength(1);
    expect(body.programs[0]).toMatchObject({ program: 'Informatica' });
    expect(body.programs[0]!.sources).toHaveLength(1);
  });

  it('promote: 404 for a nonexistent id or a source that is already default', async () => {
    const db = openDb(':memory:');
    app = await buildApp(db);
    const admin = upsertUser(db, 'admin', 'admin@example.com', 'Admin');
    const cookieHeader = sessionCookieFor(db, admin.id);

    const missingRes = await app.inject(
      jsonReq('POST', '/api/admin/sources/999/promote', cookieHeader, { program: 'Informatica' }),
    );
    expect(missingRes.statusCode).toBe(404);

    const defaultSource = insertSource(db, {
      kind: 'default',
      host: 'unito.prod.up.cineca.it',
      link_calendario_id: '613b9237d969e100173d4111',
      title: 'Already default',
      title_en: null,
      created_by: null,
    });
    const alreadyRes = await app.inject(
      jsonReq('POST', `/api/admin/sources/${defaultSource.id}/promote`, cookieHeader, { program: 'Informatica' }),
    );
    expect(alreadyRes.statusCode).toBe(404);
  });

  it('promote: 400 for a blank program', async () => {
    const db = openDb(':memory:');
    app = await buildApp(db);
    const source = customSource(db, null, '613b9237d969e100173d4110');
    const admin = upsertUser(db, 'admin', 'admin@example.com', 'Admin');
    const cookieHeader = sessionCookieFor(db, admin.id);

    const res = await app.inject(jsonReq('POST', `/api/admin/sources/${source.id}/promote`, cookieHeader, { program: '  ' }));
    expect(res.statusCode).toBe(400);
  });

  it('check: on success, marks the source as verified', async () => {
    const db = openDb(':memory:');
    app = await buildApp(db);
    const source = customSource(db, null, '613b9237d969e100173d4110');
    // Reset to "never verified" so the assertion below is deterministic, rather
    // than relying on a same-second timestamp change from insertSource's own stamp.
    db.prepare('UPDATE sources SET last_ok_at = NULL WHERE id = ?').run(source.id);
    getEventsForSourceMock.mockResolvedValue([]);

    const admin = upsertUser(db, 'admin', 'admin@example.com', 'Admin');
    const cookieHeader = sessionCookieFor(db, admin.id);
    const res = await app.inject(jsonReq('POST', `/api/admin/sources/${source.id}/check`, cookieHeader));
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });
    expect(getSourceById(db, source.id)!.last_ok_at).not.toBeNull();
    expect(getEventsForSourceMock).toHaveBeenCalledTimes(1);
  });

  it('check: on failure, reports the error and leaves the source unverified', async () => {
    const db = openDb(':memory:');
    app = await buildApp(db);
    const source = customSource(db, null, '613b9237d969e100173d4110');
    db.prepare('UPDATE sources SET last_ok_at = NULL WHERE id = ?').run(source.id);
    getEventsForSourceMock.mockRejectedValue(new SourceUnavailableError('Calendar not found'));

    const admin = upsertUser(db, 'admin', 'admin@example.com', 'Admin');
    const cookieHeader = sessionCookieFor(db, admin.id);
    const res = await app.inject(jsonReq('POST', `/api/admin/sources/${source.id}/check`, cookieHeader));
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: false, error: 'Calendar not found' });
    expect(getSourceById(db, source.id)!.last_ok_at).toBeNull();
  });
});
