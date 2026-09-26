import { describe, expect, it } from 'vitest';
import { openDb } from '../src/db/index.ts';
import {
  addProgramForUser,
  encodeGroupPath,
  listPrograms,
  listUserFolders,
  listUserPlacements,
  unlinkUserSource,
  upsertDefaultSource,
  upsertUser,
  userCanAccessSource,
} from '../src/db/repo.ts';

function makeUser(db: ReturnType<typeof openDb>, sub: string) {
  return upsertUser(db, sub, `${sub}@example.com`, sub);
}

function seedInformatica(db: ReturnType<typeof openDb>) {
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

describe('listPrograms', () => {
  it('groups default sources by program, skipping ones with none', () => {
    const db = openDb(':memory:');
    seedInformatica(db);
    upsertDefaultSource(db, {
      host: 'unito.prod.up.cineca.it',
      link_calendario_id: '612617b82db4bb0017172839',
      title: 'No program',
      title_en: null,
      group_path: null,
      program: null,
    });

    const programs = listPrograms(db);
    expect(programs).toHaveLength(1);
    expect(programs[0]!.program).toBe('Informatica');
    expect(programs[0]!.sources).toHaveLength(3);
  });
});

describe('addProgramForUser', () => {
  it('links every source of the program and organizes them into subfolders by group', () => {
    const db = openDb(':memory:');
    const user = makeUser(db, 'a');
    const { primoA, primoB, secondo } = seedInformatica(db);

    const result = addProgramForUser(db, user.id, 'Informatica');
    expect(result.added).toBe(3);
    expect(userCanAccessSource(db, user.id, primoA.id)).toBe(true);
    expect(userCanAccessSource(db, user.id, primoB.id)).toBe(true);
    expect(userCanAccessSource(db, user.id, secondo.id)).toBe(true);

    const programs = listPrograms(db);
    expect(programs[0]!.sources).toHaveLength(3);
  });

  it('is idempotent: a second call with nothing new to add is a no-op', () => {
    const db = openDb(':memory:');
    const user = makeUser(db, 'a');
    seedInformatica(db);

    addProgramForUser(db, user.id, 'Informatica');
    const second = addProgramForUser(db, user.id, 'Informatica');
    expect(second.added).toBe(0);
  });

  it('reuses the existing folder structure when re-adding after a partial removal', () => {
    const db = openDb(':memory:');
    const user = makeUser(db, 'a');
    const { primoA, primoB } = seedInformatica(db);

    addProgramForUser(db, user.id, 'Informatica');
    unlinkUserSource(db, user.id, primoA.id);
    expect(userCanAccessSource(db, user.id, primoA.id)).toBe(false);

    const result = addProgramForUser(db, user.id, 'Informatica');
    expect(result.added).toBe(1);
    expect(userCanAccessSource(db, user.id, primoA.id)).toBe(true);
    expect(userCanAccessSource(db, user.id, primoB.id)).toBe(true);
  });

  it('nests a multi-segment group_path into folders several levels deep', () => {
    const db = openDb(':memory:');
    const user = makeUser(db, 'a');
    const curriculumA = upsertDefaultSource(db, {
      host: 'unito.prod.up.cineca.it',
      link_calendario_id: '613bd49941164e0018f0f1d7',
      title: 'Canale A',
      title_en: null,
      group_path: encodeGroupPath(['Magistrale', 'Curriculum A']),
      program: 'Informatica',
    });

    addProgramForUser(db, user.id, 'Informatica');
    expect(userCanAccessSource(db, user.id, curriculumA.id)).toBe(true);

    const folders = listUserFolders(db, user.id);
    const root = folders.find((f) => f.parent_id == null)!;
    expect(root.name).toBe('Corso di Informatica');
    const magistrale = folders.find((f) => f.parent_id === root.id)!;
    expect(magistrale.name).toBe('Magistrale');
    const curriculum = folders.find((f) => f.parent_id === magistrale.id)!;
    expect(curriculum.name).toBe('Curriculum A');
    expect(folders).toHaveLength(3);

    const placements = listUserPlacements(db, user.id);
    expect(placements.get(curriculumA.id)).toBe(curriculum.id);
  });
});
