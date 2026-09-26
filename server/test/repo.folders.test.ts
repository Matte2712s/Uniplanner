import { describe, expect, it } from 'vitest';
import { openDb } from '../src/db/index.ts';
import {
  countUserFolders,
  createUserFolder,
  deleteUserFolder,
  getUserFolder,
  insertSource,
  linkUserSource,
  listUserFolders,
  listUserPlacements,
  renameUserFolder,
  setSourcePlacement,
  unlinkUserSource,
  upsertUser,
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

  it('falls a source back to unfoldered when its folder is deleted', () => {
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

    setSourcePlacement(db, user.id, source.id, folder.id);
    expect(listUserPlacements(db, user.id).get(source.id)).toBe(folder.id);

    deleteUserFolder(db, user.id, folder.id);
    expect(listUserFolders(db, user.id)).toEqual([]);
    expect(listUserPlacements(db, user.id).get(source.id)).toBeNull();
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
