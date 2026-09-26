import { createHash, randomBytes } from 'node:crypto';
import cookie from '@fastify/cookie';
import Fastify, { type FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { openDb, type Db } from '../src/db/index.ts';
import { createSession, encodeGroupPath, upsertDefaultSource, upsertUser } from '../src/db/repo.ts';
import { registerFolderRoutes } from '../src/routes/folders.ts';
import { registerProgramRoutes } from '../src/routes/programs.ts';
import { registerSourceRoutes } from '../src/routes/sources.ts';

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
  registerSourceRoutes(app, db);
  registerFolderRoutes(app, db);
  registerProgramRoutes(app, db);
  await app.ready();
  return app;
}

function seedInformatica(db: Db) {
  const primoA = upsertDefaultSource(db, {
    host: 'unito.prod.up.cineca.it',
    link_calendario_id: '613b9237d969e100173d4110',
    title: 'Canale A',
    title_en: null,
    group_path: encodeGroupPath(['Primo anno']),
    program: 'Informatica',
  });
  const primoB = upsertDefaultSource(db, {
    host: 'unito.prod.up.cineca.it',
    link_calendario_id: '613b92a1d969e100173d4111',
    title: 'Canale B',
    title_en: null,
    group_path: encodeGroupPath(['Primo anno']),
    program: 'Informatica',
  });
  const secondo = upsertDefaultSource(db, {
    host: 'unito.prod.up.cineca.it',
    link_calendario_id: '613b940fda7aec0018faeede',
    title: 'Canale A',
    title_en: null,
    group_path: encodeGroupPath(['Secondo anno']),
    program: 'Informatica',
  });
  return { primoA, primoB, secondo };
}

describe('degree program opt-in', () => {
  let app: FastifyInstance | undefined;

  afterEach(async () => {
    await app?.close();
    app = undefined;
  });

  it('shows a supported but not-yet-added program, with empty defaults, for a fresh user', async () => {
    const db = openDb(':memory:');
    seedInformatica(db);
    app = await buildApp(db);
    const user = upsertUser(db, 'a', 'a@example.com', 'A');
    const cookieHeader = sessionCookieFor(db, user.id);

    const res = await app.inject({ method: 'GET', url: '/api/sources', headers: { cookie: cookieHeader } });
    const body = res.json() as {
      defaults: unknown[];
      programs: { program: string; added: boolean; sources: unknown[] }[];
    };
    expect(body.defaults).toEqual([]);
    expect(body.programs).toHaveLength(1);
    expect(body.programs[0]).toMatchObject({ program: 'Informatica', added: false });
    expect(body.programs[0]!.sources).toHaveLength(3);
  });

  it('anonymous requests never see anything added, regardless of any session state', async () => {
    const db = openDb(':memory:');
    seedInformatica(db);
    app = await buildApp(db);

    const res = await app.inject({ method: 'GET', url: '/api/sources' });
    const body = res.json() as { defaults: unknown[]; programs: { added: boolean }[] };
    expect(body.defaults).toEqual([]);
    expect(body.programs[0]!.added).toBe(false);
  });

  it('adding a program links its sources and creates a subfoldered structure', async () => {
    const db = openDb(':memory:');
    seedInformatica(db);
    app = await buildApp(db);
    const user = upsertUser(db, 'a', 'a@example.com', 'A');
    const cookieHeader = sessionCookieFor(db, user.id);

    const addRes = await app.inject({ method: 'POST', url: '/api/programs/Informatica/add', headers: { cookie: cookieHeader } });
    expect(addRes.statusCode).toBe(200);
    expect(addRes.json()).toEqual({ ok: true, added: 3 });

    const res = await app.inject({ method: 'GET', url: '/api/sources', headers: { cookie: cookieHeader } });
    const body = res.json() as {
      defaults: { id: number; folderId: number | null }[];
      folders: { id: number; name: string; parentId: number | null }[];
      programs: { added: boolean }[];
    };
    expect(body.defaults).toHaveLength(3);
    expect(body.programs[0]!.added).toBe(true);

    const root = body.folders.find((f) => f.parentId === null);
    expect(root?.name).toBe('Corso di Informatica');
    const subfolders = body.folders.filter((f) => f.parentId === root!.id);
    expect(subfolders.map((f) => f.name).sort()).toEqual(['Primo anno', 'Secondo anno']);

    // A second add is a no-op - nothing duplicated.
    const secondAdd = await app.inject({ method: 'POST', url: '/api/programs/Informatica/add', headers: { cookie: cookieHeader } });
    expect(secondAdd.json()).toEqual({ ok: true, added: 0 });
    const afterSecond = await app.inject({ method: 'GET', url: '/api/sources', headers: { cookie: cookieHeader } });
    expect((afterSecond.json() as { folders: unknown[] }).folders).toHaveLength(3);
  });

  it('404s for an unknown program', async () => {
    const db = openDb(':memory:');
    seedInformatica(db);
    app = await buildApp(db);
    const user = upsertUser(db, 'a', 'a@example.com', 'A');
    const cookieHeader = sessionCookieFor(db, user.id);

    const res = await app.inject({ method: 'POST', url: '/api/programs/Fisica/add', headers: { cookie: cookieHeader } });
    expect(res.statusCode).toBe(404);
  });

  it('removing one source then re-adding the program only restores that one, reusing the existing folder', async () => {
    const db = openDb(':memory:');
    const { primoA } = seedInformatica(db);
    app = await buildApp(db);
    const user = upsertUser(db, 'a', 'a@example.com', 'A');
    const cookieHeader = sessionCookieFor(db, user.id);

    await app.inject({ method: 'POST', url: '/api/programs/Informatica/add', headers: { cookie: cookieHeader } });
    const removeRes = await app.inject({ method: 'DELETE', url: `/api/sources/${primoA.id}`, headers: { cookie: cookieHeader } });
    expect(removeRes.statusCode).toBe(200);

    const afterRemove = await app.inject({ method: 'GET', url: '/api/sources', headers: { cookie: cookieHeader } });
    expect((afterRemove.json() as { defaults: unknown[] }).defaults).toHaveLength(2);

    const readdRes = await app.inject({ method: 'POST', url: '/api/programs/Informatica/add', headers: { cookie: cookieHeader } });
    expect(readdRes.json()).toEqual({ ok: true, added: 1 });

    const afterReadd = await app.inject({ method: 'GET', url: '/api/sources', headers: { cookie: cookieHeader } });
    const body = afterReadd.json() as { defaults: { id: number }[]; folders: unknown[] };
    expect(body.defaults).toHaveLength(3);
    expect(body.folders).toHaveLength(3); // no duplicate root/subfolder created
  });
});
