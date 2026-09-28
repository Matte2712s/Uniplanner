import { describe, expect, it } from 'vitest';
import { openDb } from '../src/db/index.ts';
import { findSource, insertSource, upsertDefaultSource, upsertUser } from '../src/db/repo.ts';

describe('upsertDefaultSource', () => {
  it('promotes an existing custom source to default when a config entry matches it', () => {
    const db = openDb(':memory:');
    const creator = upsertUser(db, 'a', 'creator@example.com', 'Creator');
    const custom = insertSource(db, {
      kind: 'custom',
      host: 'unito.prod.up.cineca.it',
      link_calendario_id: '613b9237d969e100173d4110',
      title: 'Whatever I called it',
      title_en: null,
      created_by: creator.id,
    });

    const result = upsertDefaultSource(db, {
      host: 'unito.prod.up.cineca.it',
      link_calendario_id: '613b9237d969e100173d4110',
      title: 'Canale A',
      title_en: 'Channel A',
      group_path: null,
      program: 'Informatica',
    });

    expect(result.id).toBe(custom.id);
    expect(result.kind).toBe('default');
    expect(result.title).toBe('Canale A');
    expect(result.program).toBe('Informatica');
    // Still the same single row - never duplicated.
    expect(findSource(db, 'unito.prod.up.cineca.it', '613b9237d969e100173d4110')!.id).toBe(custom.id);
  });

  it('still refreshes an already-default source in place', () => {
    const db = openDb(':memory:');
    upsertDefaultSource(db, {
      host: 'unito.prod.up.cineca.it',
      link_calendario_id: '613b9237d969e100173d4110',
      title: 'Old title',
      title_en: null,
      group_path: null,
      program: 'Informatica',
    });
    const result = upsertDefaultSource(db, {
      host: 'unito.prod.up.cineca.it',
      link_calendario_id: '613b9237d969e100173d4110',
      title: 'New title',
      title_en: null,
      group_path: null,
      program: 'Informatica',
    });
    expect(result.kind).toBe('default');
    expect(result.title).toBe('New title');
  });
});
