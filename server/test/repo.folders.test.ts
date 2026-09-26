import { describe, expect, it } from 'vitest';
import { defaultViewSettings } from '@planner/shared';
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
