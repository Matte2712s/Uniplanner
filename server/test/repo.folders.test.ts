import { describe, expect, it } from 'vitest';
import { childrenOf, defaultViewSettings } from '@planner/shared';
import { openDb } from '../src/db/index.ts';
import {
  countUserFolders,
  createUserFolder,
  createView,
  deleteUserFolder,
  getUserFolder,
  getView,
  insertSource,
  linkUserSource,
  listUserFolders,
  listUserPlacements,
  listUserSourceNames,
  listUserSourcePositions,
  moveUserFolder,
  renameUserFolder,
  renameUserSource,
  setSourcePlacement,
  unlinkUserSource,
  upsertUser,
  userCanAccessSource,
} from '../src/db/repo.ts';

function makeUser(db: ReturnType<typeof openDb>, sub: string) {
  return upsertUser(db, sub, `${sub}@example.com`, sub);
}

describe('user folders', () => {
  it('creates folders with an incrementing position, scoped per user', () => {
    const db = openDb(':memory:');
    const a = makeUser(db, 'user-a');
    const b = makeUser(db, 'user-b');

    const f1 = createUserFolder(db, a.id, 'Primo anno');
    const f2 = createUserFolder(db, a.id, 'Secondo anno');
    createUserFolder(db, b.id, 'Altro utente');

    expect(f1.position).toBe(0);
    expect(f2.position).toBe(1);
    expect(listUserFolders(db, a.id).map((f) => f.name)).toEqual(['Primo anno', 'Secondo anno']);
    expect(countUserFolders(db, a.id)).toBe(2);
    expect(countUserFolders(db, b.id)).toBe(1);
  });

  it('reorders siblings and keeps positions contiguous', () => {
    const db = openDb(':memory:');
    const user = makeUser(db, 'user-a');
    const a = createUserFolder(db, user.id, 'A');
    createUserFolder(db, user.id, 'B');
    const c = createUserFolder(db, user.id, 'C');

    moveUserFolder(db, user.id, c.id, null, 0);
    expect(listUserFolders(db, user.id).map((f) => [f.name, f.position])).toEqual([['C', 0], ['A', 1], ['B', 2]]);

    moveUserFolder(db, user.id, c.id, null, 2);
    expect(listUserFolders(db, user.id).map((f) => f.name)).toEqual(['A', 'B', 'C']);

    // No index appends, like a plain reparent always has
    moveUserFolder(db, user.id, a.id, null);
    expect(listUserFolders(db, user.id).map((f) => [f.name, f.position])).toEqual([['B', 0], ['C', 1], ['A', 2]]);
  });

  it('inserts a reparented folder at the requested slot among its new siblings', () => {
    const db = openDb(':memory:');
    const user = makeUser(db, 'user-a');
    const parent = createUserFolder(db, user.id, 'Parent');
    createUserFolder(db, user.id, 'First', parent.id);
    createUserFolder(db, user.id, 'Second', parent.id);
    const mover = createUserFolder(db, user.id, 'Mover');

    const moved = moveUserFolder(db, user.id, mover.id, parent.id, 1);
    expect(moved?.parent_id).toBe(parent.id);
    const children = listUserFolders(db, user.id).filter((f) => f.parent_id === parent.id);
    expect(children.map((f) => [f.name, f.position])).toEqual([['First', 0], ['Mover', 1], ['Second', 2]]);
  });

  it('does not touch another user\'s folders or move a folder it does not own', () => {
    const db = openDb(':memory:');
    const a = makeUser(db, 'user-a');
    const b = makeUser(db, 'user-b');
    const mine = createUserFolder(db, a.id, 'Mine');
    const theirs = createUserFolder(db, b.id, 'Theirs');

    expect(moveUserFolder(db, a.id, theirs.id, null, 0)).toBeUndefined();
    expect(getUserFolder(db, b.id, theirs.id)?.position).toBe(0);
    expect(getUserFolder(db, a.id, mine.id)?.position).toBe(0);
  });

  it('scopes lookups and renames to the owning user', () => {
    const db = openDb(':memory:');
    const a = makeUser(db, 'user-a');
    const b = makeUser(db, 'user-b');
    const folder = createUserFolder(db, a.id, 'Mine');

    expect(getUserFolder(db, b.id, folder.id)).toBeUndefined();
    expect(getUserFolder(db, a.id, folder.id)?.name).toBe('Mine');

    expect(renameUserFolder(db, b.id, folder.id, 'Hijacked')).toBeUndefined();
    expect(renameUserFolder(db, a.id, folder.id, 'Renamed')?.name).toBe('Renamed');
    expect(getUserFolder(db, a.id, folder.id)?.name).toBe('Renamed');
  });

  it('deletes (unlinks) sources placed in a folder when the folder is deleted', () => {
    const db = openDb(':memory:');
    const user = makeUser(db, 'user-a');
    const source = insertSource(db, {
      kind: 'custom',
      host: 'unito.prod.up.cineca.it',
      link_calendario_id: '612617b82db4bb0017172839',
      title: 'Test',
      title_en: null,
      created_by: user.id,
    });
    const folder = createUserFolder(db, user.id, 'Temp');

    linkUserSource(db, user.id, source.id);
    setSourcePlacement(db, user.id, source.id, folder.id);
    expect(listUserPlacements(db, user.id).get(source.id)).toBe(folder.id);

    deleteUserFolder(db, user.id, folder.id);
    expect(listUserFolders(db, user.id)).toEqual([]);
    expect(listUserPlacements(db, user.id).has(source.id)).toBe(false);
    expect(userCanAccessSource(db, user.id, source.id)).toBe(false);
  });

  it('cascades a folder deletion through nested subfolders and deletes sources anywhere in the subtree', () => {
    const db = openDb(':memory:');
    const user = makeUser(db, 'user-a');
    const source = insertSource(db, {
      kind: 'custom',
      host: 'unito.prod.up.cineca.it',
      link_calendario_id: '612617b82db4bb0017172839',
      title: 'Test',
      title_en: null,
      created_by: user.id,
    });
    const parent = createUserFolder(db, user.id, 'Parent');
    const child = createUserFolder(db, user.id, 'Child', parent.id);

    linkUserSource(db, user.id, source.id);
    setSourcePlacement(db, user.id, source.id, child.id);

    deleteUserFolder(db, user.id, parent.id);
    expect(listUserFolders(db, user.id)).toEqual([]);
    expect(userCanAccessSource(db, user.id, source.id)).toBe(false);
  });

  it('forgets a source\'s course selections in every view once it is unlinked', () => {
    const db = openDb(':memory:');
    const user = makeUser(db, 'user-a');
    const source = insertSource(db, {
      kind: 'custom',
      host: 'unito.prod.up.cineca.it',
      link_calendario_id: '612617b82db4bb0017172839',
      title: 'Test',
      title_en: null,
      created_by: user.id,
    });
    linkUserSource(db, user.id, source.id);

    const settings = { ...defaultViewSettings(), sources: [{ sourceId: source.id, courseMode: 'include' as const, courses: ['a'] }] };
    const view = createView(db, user.id, 'My view', settings);

    unlinkUserSource(db, user.id, source.id);

    expect(getView(db, user.id, view.id)?.settings.sources).toEqual([]);
  });

  it('sets and lists a per-user source rename override', () => {
    const db = openDb(':memory:');
    const user = makeUser(db, 'user-a');
    const source = insertSource(db, {
      kind: 'custom',
      host: 'unito.prod.up.cineca.it',
      link_calendario_id: '612617b82db4bb0017172839',
      title: 'Test',
      title_en: null,
      created_by: user.id,
    });

    expect(listUserSourceNames(db, user.id).has(source.id)).toBe(false);
    renameUserSource(db, user.id, source.id, 'My renamed source');
    expect(listUserSourceNames(db, user.id).get(source.id)).toBe('My renamed source');
  });

  it('drops the placement row when a custom source is unlinked', () => {
    const db = openDb(':memory:');
    const user = makeUser(db, 'user-a');
    const source = insertSource(db, {
      kind: 'custom',
      host: 'unito.prod.up.cineca.it',
      link_calendario_id: '612617b82db4bb0017172839',
      title: 'Test',
      title_en: null,
      created_by: user.id,
    });
    linkUserSource(db, user.id, source.id);
    setSourcePlacement(db, user.id, source.id, createUserFolder(db, user.id, 'F').id);

    expect(listUserPlacements(db, user.id).has(source.id)).toBe(true);
    unlinkUserSource(db, user.id, source.id);
    expect(listUserPlacements(db, user.id).has(source.id)).toBe(false);
  });
});

function makeSource(db: ReturnType<typeof openDb>, userId: number, n: number) {
  const source = insertSource(db, {
    kind: 'custom',
    host: 'unito.prod.up.cineca.it',
    link_calendario_id: n.toString(16).padStart(24, '0'),
    title: `Source ${n}`,
    title_en: null,
    created_by: userId,
  });
  linkUserSource(db, userId, source.id);
  return source;
}

/** What a folder contains, subfolders and sources together, in display order. */
function contentsOf(db: ReturnType<typeof openDb>, userId: number, folderId: number): string[] {
  const folders = listUserFolders(db, userId).map((f) => ({ id: f.id, name: f.name, position: f.position, parentId: f.parent_id }));
  const positions = listUserSourcePositions(db, userId);
  const sources = [...listUserPlacements(db, userId)].map(([id, fid]) => ({ id, folderId: fid, position: positions.get(id) ?? 0 }));
  const nameOf = new Map(folders.map((f) => [f.id, f.name]));
  return childrenOf(folders, sources, folderId).map((c) => (c.kind === 'folder' ? nameOf.get(c.id)! : `s${c.id}`));
}

describe('ordering sources among subfolders', () => {
  it('appends newly placed sources and new subfolders after whatever is already in the folder', () => {
    const db = openDb(':memory:');
    const user = makeUser(db, 'user-a');
    const parent = createUserFolder(db, user.id, 'Parent');
    const s1 = makeSource(db, user.id, 1);
    const s2 = makeSource(db, user.id, 2);

    setSourcePlacement(db, user.id, s1.id, parent.id);
    createUserFolder(db, user.id, 'Sub', parent.id);
    setSourcePlacement(db, user.id, s2.id, parent.id);

    expect(contentsOf(db, user.id, parent.id)).toEqual([`s${s1.id}`, 'Sub', `s${s2.id}`]);
  });

  it('moves a source to a slot among the subfolders and renumbers the folder', () => {
    const db = openDb(':memory:');
    const user = makeUser(db, 'user-a');
    const parent = createUserFolder(db, user.id, 'Parent');
    createUserFolder(db, user.id, 'First', parent.id);
    createUserFolder(db, user.id, 'Second', parent.id);
    const source = makeSource(db, user.id, 1);
    setSourcePlacement(db, user.id, source.id, parent.id, 0);
    expect(contentsOf(db, user.id, parent.id)).toEqual([`s${source.id}`, 'First', 'Second']);

    setSourcePlacement(db, user.id, source.id, parent.id, 2);

    expect(contentsOf(db, user.id, parent.id)).toEqual(['First', 'Second', `s${source.id}`]);
    expect(listUserSourcePositions(db, user.id).get(source.id)).toBe(2);
    expect(listUserFolders(db, user.id).filter((f) => f.parent_id === parent.id).map((f) => [f.name, f.position])).toEqual([
      ['First', 0],
      ['Second', 1],
    ]);

    setSourcePlacement(db, user.id, source.id, parent.id, 1);
    expect(contentsOf(db, user.id, parent.id)).toEqual(['First', `s${source.id}`, 'Second']);
  });

  it('reorders sources within a folder', () => {
    const db = openDb(':memory:');
    const user = makeUser(db, 'user-a');
    const folder = createUserFolder(db, user.id, 'F');
    const [a, b, c] = [1, 2, 3].map((n) => makeSource(db, user.id, n));
    for (const s of [a!, b!, c!]) setSourcePlacement(db, user.id, s.id, folder.id);

    setSourcePlacement(db, user.id, c!.id, folder.id, 0);
    expect(contentsOf(db, user.id, folder.id)).toEqual([`s${c!.id}`, `s${a!.id}`, `s${b!.id}`]);
  });

  it('moves a folder past the sources of its new parent', () => {
    const db = openDb(':memory:');
    const user = makeUser(db, 'user-a');
    const parent = createUserFolder(db, user.id, 'Parent');
    const s1 = makeSource(db, user.id, 1);
    const s2 = makeSource(db, user.id, 2);
    setSourcePlacement(db, user.id, s1.id, parent.id);
    setSourcePlacement(db, user.id, s2.id, parent.id);
    const mover = createUserFolder(db, user.id, 'Mover');

    moveUserFolder(db, user.id, mover.id, parent.id, 1);
    expect(contentsOf(db, user.id, parent.id)).toEqual([`s${s1.id}`, 'Mover', `s${s2.id}`]);
  });

  it('moves a source between folders at the requested slot, leaving the old folder alone', () => {
    const db = openDb(':memory:');
    const user = makeUser(db, 'user-a');
    const from = createUserFolder(db, user.id, 'From');
    const to = createUserFolder(db, user.id, 'To');
    createUserFolder(db, user.id, 'Inside', to.id);
    const source = makeSource(db, user.id, 1);
    setSourcePlacement(db, user.id, source.id, from.id);

    setSourcePlacement(db, user.id, source.id, to.id, 1);
    expect(contentsOf(db, user.id, to.id)).toEqual(['Inside', `s${source.id}`]);
    expect(contentsOf(db, user.id, from.id)).toEqual([]);
  });

  it('does not order root-level sources or fail on an index there', () => {
    const db = openDb(':memory:');
    const user = makeUser(db, 'user-a');
    const source = makeSource(db, user.id, 1);

    setSourcePlacement(db, user.id, source.id, null, 3);
    expect(listUserPlacements(db, user.id).get(source.id)).toBeNull();
    expect(listUserSourcePositions(db, user.id).get(source.id)).toBe(0);
  });

  it("keeps one user's ordering out of another's", () => {
    const db = openDb(':memory:');
    const a = makeUser(db, 'user-a');
    const b = makeUser(db, 'user-b');
    const folderA = createUserFolder(db, a.id, 'F');
    const folderB = createUserFolder(db, b.id, 'F');
    const shared = makeSource(db, a.id, 1);
    linkUserSource(db, b.id, shared.id);
    setSourcePlacement(db, a.id, shared.id, folderA.id);
    setSourcePlacement(db, b.id, shared.id, folderB.id);
    createUserFolder(db, a.id, 'Sub', folderA.id);

    setSourcePlacement(db, a.id, shared.id, folderA.id, 1);
    expect(contentsOf(db, a.id, folderA.id)).toEqual(['Sub', `s${shared.id}`]);
    expect(contentsOf(db, b.id, folderB.id)).toEqual([`s${shared.id}`]);
  });
});
