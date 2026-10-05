import { createHash, randomBytes } from 'node:crypto';
import cookie from '@fastify/cookie';
import Fastify, { type FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { MAX_FOLDER_NAME_LENGTH, MAX_FOLDERS_PER_USER } from '@planner/shared';
import { openDb, type Db } from '../src/db/index.ts';
import { createSession, insertSource, linkUserSource, upsertUser } from '../src/db/repo.ts';
import { registerFolderRoutes } from '../src/routes/folders.ts';
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

/** A default source the user already has access to (mirrors what addProgramForUser would have linked). */
function linkedDefaultSource(db: Db, userId: number, linkId: string, title: string) {
  const source = insertSource(db, {
    kind: 'default',
    host: 'unito.prod.up.cineca.it',
    link_calendario_id: linkId,
    title,
    title_en: null,
    created_by: null,
  });
  linkUserSource(db, userId, source.id);
  return source;
}

describe('folder + placement routes', () => {
  let app: FastifyInstance | undefined;

  afterEach(async () => {
    await app?.close();
    app = undefined;
  });

  it('lets a user create a folder and move a linked default source into it', async () => {
    const db = openDb(':memory:');
    app = await buildApp(db);
    const user = upsertUser(db, 'a', 'a@example.com', 'A');
    const cookieHeader = sessionCookieFor(db, user.id);

    const d1 = linkedDefaultSource(db, user.id, '612617b82db4bb0017172839', 'Canale A');

    const createFolderRes = await app.inject(jsonReq('POST', '/api/folders', cookieHeader, { name: 'Anno 1' }));
    expect(createFolderRes.statusCode).toBe(200);
    const folder = createFolderRes.json().folder;
    expect(folder.name).toBe('Anno 1');

    const moveRes = await app.inject(
      jsonReq('PUT', `/api/sources/${d1.id}/placement`, cookieHeader, { folderId: folder.id }),
    );
    expect(moveRes.statusCode).toBe(200);

    const sourcesRes = await app.inject({ method: 'GET', url: '/api/sources', headers: { cookie: cookieHeader } });
    const body = sourcesRes.json() as { defaults: { id: number; folderId: number | null }[]; folders: unknown[] };
    expect(body.folders).toHaveLength(1);
    expect(body.defaults.find((s) => s.id === d1.id)).toMatchObject({ folderId: folder.id });

    // Deleting the folder deletes (unlinks) the source it contained.
    const deleteRes = await app.inject({ method: 'DELETE', url: `/api/folders/${folder.id}`, headers: { cookie: cookieHeader } });
    expect(deleteRes.statusCode).toBe(200);
    const afterDelete = await app.inject({ method: 'GET', url: '/api/sources', headers: { cookie: cookieHeader } });
    const afterBody = afterDelete.json() as { defaults: { id: number; folderId: number | null }[] };
    expect(afterBody.defaults.find((s) => s.id === d1.id)).toBeUndefined();
  });

  it('nests folders, cascades a delete to the whole subtree, and deletes sources placed in it', async () => {
    const db = openDb(':memory:');
    app = await buildApp(db);
    const user = upsertUser(db, 'a', 'a@example.com', 'A');
    const cookieHeader = sessionCookieFor(db, user.id);

    const parent = (await app.inject(jsonReq('POST', '/api/folders', cookieHeader, { name: 'Parent' }))).json().folder;
    const child = (await app.inject(jsonReq('POST', '/api/folders', cookieHeader, { name: 'Child' }))).json().folder;
    const reparentRes = await app.inject(jsonReq('PUT', `/api/folders/${child.id}`, cookieHeader, { parentId: parent.id }));
    expect(reparentRes.statusCode).toBe(200);
    expect(reparentRes.json().folder.parentId).toBe(parent.id);

    const source = linkedDefaultSource(db, user.id, '612617b82db4bb0017172839', 'Canale A');
    await app.inject(jsonReq('PUT', `/api/sources/${source.id}/placement`, cookieHeader, { folderId: child.id }));

    const deleteRes = await app.inject({ method: 'DELETE', url: `/api/folders/${parent.id}`, headers: { cookie: cookieHeader } });
    expect(deleteRes.statusCode).toBe(200);

    const sourcesRes = await app.inject({ method: 'GET', url: '/api/sources', headers: { cookie: cookieHeader } });
    const body = sourcesRes.json() as { defaults: { id: number; folderId: number | null }[]; folders: unknown[] };
    expect(body.folders).toHaveLength(0);
    expect(body.defaults.find((s) => s.id === source.id)).toBeUndefined();
  });

  it('rejects reparenting a folder under its own descendant, and under an unowned folder', async () => {
    const db = openDb(':memory:');
    app = await buildApp(db);
    const user = upsertUser(db, 'a', 'a@example.com', 'A');
    const stranger = upsertUser(db, 'b', 'b@example.com', 'B');
    const cookieHeader = sessionCookieFor(db, user.id);
    const cookieStranger = sessionCookieFor(db, stranger.id);

    const grandparent = (await app.inject(jsonReq('POST', '/api/folders', cookieHeader, { name: 'GP' }))).json().folder;
    const parent = (await app.inject(jsonReq('POST', '/api/folders', cookieHeader, { name: 'P' }))).json().folder;
    await app.inject(jsonReq('PUT', `/api/folders/${parent.id}`, cookieHeader, { parentId: grandparent.id }));

    const cycleRes = await app.inject(jsonReq('PUT', `/api/folders/${grandparent.id}`, cookieHeader, { parentId: parent.id }));
    expect(cycleRes.statusCode).toBe(400);
    expect(cycleRes.json().error).toBe('invalid_parent');

    const selfRes = await app.inject(jsonReq('PUT', `/api/folders/${parent.id}`, cookieHeader, { parentId: parent.id }));
    expect(selfRes.statusCode).toBe(400);
    expect(selfRes.json().error).toBe('invalid_parent');

    const strangerFolder = (await app.inject(jsonReq('POST', '/api/folders', cookieStranger, { name: 'Stranger' }))).json().folder;
    const unownedRes = await app.inject(jsonReq('PUT', `/api/folders/${parent.id}`, cookieHeader, { parentId: strangerFolder.id }));
    expect(unownedRes.statusCode).toBe(400);
    expect(unownedRes.json().error).toBe('invalid_folder');
  });

  it('reorders sibling folders through PUT /api/folders/:id with an index', async () => {
    const db = openDb(':memory:');
    const server = (app = await buildApp(db));
    const user = upsertUser(db, 'a', 'a@example.com', 'A');
    const cookieHeader = sessionCookieFor(db, user.id);

    const ids: number[] = [];
    for (const name of ['A', 'B', 'C']) {
      ids.push((await app.inject(jsonReq('POST', '/api/folders', cookieHeader, { name }))).json().folder.id);
    }

    const orderOf = async () => {
      const res = await server.inject({ method: 'GET', url: '/api/sources', headers: { cookie: cookieHeader } });
      const folders = (res.json() as { folders: { id: number; name: string; position: number }[] }).folders;
      return folders.sort((x, y) => x.position - y.position).map((f) => f.name);
    };

    // Index alone keeps the current parent
    const upRes = await app.inject(jsonReq('PUT', `/api/folders/${ids[2]}`, cookieHeader, { index: 0 }));
    expect(upRes.statusCode).toBe(200);
    expect(await orderOf()).toEqual(['C', 'A', 'B']);

    const downRes = await app.inject(jsonReq('PUT', `/api/folders/${ids[2]}`, cookieHeader, { parentId: null, index: 2 }));
    expect(downRes.statusCode).toBe(200);
    expect(await orderOf()).toEqual(['A', 'B', 'C']);

    const negative = await app.inject(jsonReq('PUT', `/api/folders/${ids[2]}`, cookieHeader, { index: -1 }));
    expect(negative.statusCode).toBe(400);
  });

  it('places a folder at an index while reparenting it, and still rejects cycles', async () => {
    const db = openDb(':memory:');
    app = await buildApp(db);
    const user = upsertUser(db, 'a', 'a@example.com', 'A');
    const cookieHeader = sessionCookieFor(db, user.id);

    const parent = (await app.inject(jsonReq('POST', '/api/folders', cookieHeader, { name: 'Parent' }))).json().folder;
    const first = (await app.inject(jsonReq('POST', '/api/folders', cookieHeader, { name: 'First' }))).json().folder;
    const second = (await app.inject(jsonReq('POST', '/api/folders', cookieHeader, { name: 'Second' }))).json().folder;
    await app.inject(jsonReq('PUT', `/api/folders/${first.id}`, cookieHeader, { parentId: parent.id }));
    await app.inject(jsonReq('PUT', `/api/folders/${second.id}`, cookieHeader, { parentId: parent.id, index: 0 }));

    const res = await app.inject({ method: 'GET', url: '/api/sources', headers: { cookie: cookieHeader } });
    const folders = (res.json() as { folders: { id: number; parentId: number | null; position: number }[] }).folders;
    const children = folders.filter((f) => f.parentId === parent.id).sort((x, y) => x.position - y.position);
    expect(children.map((f) => f.id)).toEqual([second.id, first.id]);

    const cycle = await app.inject(jsonReq('PUT', `/api/folders/${parent.id}`, cookieHeader, { parentId: first.id, index: 0 }));
    expect(cycle.statusCode).toBe(400);
    expect(cycle.json().error).toBe('invalid_parent');
  });

  it('orders a source among subfolders through PUT /api/sources/:id/placement with an index', async () => {
    const db = openDb(':memory:');
    app = await buildApp(db);
    const user = upsertUser(db, 'a', 'a@example.com', 'A');
    const cookieHeader = sessionCookieFor(db, user.id);

    const parent = (await app.inject(jsonReq('POST', '/api/folders', cookieHeader, { name: 'Parent' }))).json().folder;
    const first = (await app.inject(jsonReq('POST', '/api/folders', cookieHeader, { name: 'First' }))).json().folder;
    const second = (await app.inject(jsonReq('POST', '/api/folders', cookieHeader, { name: 'Second' }))).json().folder;
    for (const f of [first, second]) await app.inject(jsonReq('PUT', `/api/folders/${f.id}`, cookieHeader, { parentId: parent.id }));
    const source = linkedDefaultSource(db, user.id, '612617b82db4bb0017172839', 'Magistrale');

    const place = (index?: number) =>
      app!.inject(jsonReq('PUT', `/api/sources/${source.id}/placement`, cookieHeader, { folderId: parent.id, index }));
    const positions = async () => {
      const res = await app!.inject({ method: 'GET', url: '/api/sources', headers: { cookie: cookieHeader } });
      const body = res.json() as {
        defaults: { id: number; position: number }[];
        folders: { id: number; parentId: number | null; position: number }[];
      };
      return {
        source: body.defaults.find((s) => s.id === source.id)!.position,
        first: body.folders.find((f) => f.id === first.id)!.position,
        second: body.folders.find((f) => f.id === second.id)!.position,
      };
    };

    // No index appends after both subfolders
    expect((await place()).statusCode).toBe(200);
    expect(await positions()).toEqual({ first: 0, second: 1, source: 2 });

    // Slot between the two
    expect((await place(1)).statusCode).toBe(200);
    expect(await positions()).toEqual({ first: 0, source: 1, second: 2 });

    // Slot on top
    expect((await place(0)).statusCode).toBe(200);
    expect(await positions()).toEqual({ source: 0, first: 1, second: 2 });

    const negative = await place(-1);
    expect(negative.statusCode).toBe(400);
  });

  it('puts a subfolder created via the API after the sources already in its parent', async () => {
    const db = openDb(':memory:');
    app = await buildApp(db);
    const user = upsertUser(db, 'a', 'a@example.com', 'A');
    const cookieHeader = sessionCookieFor(db, user.id);

    const parent = (await app.inject(jsonReq('POST', '/api/folders', cookieHeader, { name: 'Parent' }))).json().folder;
    const source = linkedDefaultSource(db, user.id, '612617b82db4bb0017172839', 'Canale A');
    await app.inject(jsonReq('PUT', `/api/sources/${source.id}/placement`, cookieHeader, { folderId: parent.id }));
    const child = (await app.inject(jsonReq('POST', '/api/folders', cookieHeader, { name: 'Child' }))).json().folder;
    const moved = await app.inject(jsonReq('PUT', `/api/folders/${child.id}`, cookieHeader, { parentId: parent.id }));
    expect(moved.statusCode).toBe(200);
    // Reparenting without an index appends after the source
    expect(moved.json().folder.position).toBe(1);
  });

  it('rejects moving a source into a folder owned by someone else', async () => {
    const db = openDb(':memory:');
    app = await buildApp(db);
    const a = upsertUser(db, 'a', 'a@example.com', 'A');
    const b = upsertUser(db, 'b', 'b@example.com', 'B');
    const cookieA = sessionCookieFor(db, a.id);
    const cookieB = sessionCookieFor(db, b.id);

    const folderBRes = await app.inject(jsonReq('POST', '/api/folders', cookieB, { name: "B's folder" }));
    const folderB = folderBRes.json().folder;

    const source = linkedDefaultSource(db, a.id, '612617b82db4bb0017172839', 'Shared');

    const res = await app.inject(jsonReq('PUT', `/api/sources/${source.id}/placement`, cookieA, { folderId: folderB.id }));
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('invalid_folder');

    const renameRes = await app.inject(jsonReq('PUT', `/api/folders/${folderB.id}`, cookieA, { name: 'Hijacked' }));
    expect(renameRes.statusCode).toBe(404);
  });

  it('lets a user rename a source they can access', async () => {
    const db = openDb(':memory:');
    app = await buildApp(db);
    const user = upsertUser(db, 'a', 'a@example.com', 'A');
    const cookieHeader = sessionCookieFor(db, user.id);

    const source = linkedDefaultSource(db, user.id, '612617b82db4bb0017172839', 'Canale A');

    const renameRes = await app.inject(jsonReq('PUT', `/api/sources/${source.id}/name`, cookieHeader, { name: 'My channel' }));
    expect(renameRes.statusCode).toBe(200);

    const sourcesRes = await app.inject({ method: 'GET', url: '/api/sources', headers: { cookie: cookieHeader } });
    const body = sourcesRes.json() as { defaults: { id: number; displayName: string | null }[] };
    expect(body.defaults.find((s) => s.id === source.id)?.displayName).toBe('My channel');

    const emptyName = await app.inject(jsonReq('PUT', `/api/sources/${source.id}/name`, cookieHeader, { name: '   ' }));
    expect(emptyName.statusCode).toBe(400);
  });

  it("rejects placement changes on a source the requester doesn't have access to", async () => {
    const db = openDb(':memory:');
    app = await buildApp(db);
    const owner = upsertUser(db, 'a', 'a@example.com', 'A');
    const stranger = upsertUser(db, 'b', 'b@example.com', 'B');
    const cookieStranger = sessionCookieFor(db, stranger.id);
    const custom = insertSource(db, {
      kind: 'custom',
      host: 'unito.prod.up.cineca.it',
      link_calendario_id: '612617b82db4bb0017172839',
      title: "Owner's",
      title_en: null,
      created_by: owner.id,
    });
    linkUserSource(db, owner.id, custom.id);

    const res = await app.inject(jsonReq('PUT', `/api/sources/${custom.id}/placement`, cookieStranger, { folderId: null }));
    expect(res.statusCode).toBe(404);
  });

  it('enforces the folder name schema and the per-user folder cap', async () => {
    const db = openDb(':memory:');
    app = await buildApp(db);
    const user = upsertUser(db, 'a', 'a@example.com', 'A');
    const cookieHeader = sessionCookieFor(db, user.id);

    const empty = await app.inject(jsonReq('POST', '/api/folders', cookieHeader, { name: '   ' }));
    expect(empty.statusCode).toBe(400);

    const tooLong = await app.inject(
      jsonReq('POST', '/api/folders', cookieHeader, { name: 'x'.repeat(MAX_FOLDER_NAME_LENGTH + 1) }),
    );
    expect(tooLong.statusCode).toBe(400);

    const controlChar = await app.inject(jsonReq('POST', '/api/folders', cookieHeader, { name: 'Anno\n1' }));
    expect(controlChar.statusCode).toBe(400);

    for (let i = 0; i < MAX_FOLDERS_PER_USER; i++) {
      const res = await app.inject(jsonReq('POST', '/api/folders', cookieHeader, { name: `Folder ${i}` }));
      expect(res.statusCode).toBe(200);
    }
    const overLimit = await app.inject(jsonReq('POST', '/api/folders', cookieHeader, { name: 'One too many' }));
    expect(overLimit.statusCode).toBe(400);
    expect(overLimit.json().error).toBe('too_many_folders');
  });
});
