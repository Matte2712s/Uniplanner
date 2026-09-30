import type { FastifyBaseLogger } from 'fastify';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { openDb } from '../src/db/index.ts';
import { insertSource, saveCachedCourses, upsertDefaultSource } from '../src/db/repo.ts';

const getEventsMock = vi.fn();
vi.mock('../src/cineca/service.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/cineca/service.ts')>();
  return { ...actual, getEventsForSource: getEventsMock };
});

const { warmCourses } = await import('../src/courseWarmer.ts');

const DAY_MS = 24 * 60 * 60 * 1000;
const HOST = 'unito.prod.up.cineca.it';
const log = { info: vi.fn(), warn: vi.fn() } as unknown as FastifyBaseLogger;

beforeEach(() => {
  getEventsMock.mockReset();
  getEventsMock.mockResolvedValue([]);
});

function addDefault(db: ReturnType<typeof openDb>, n: number, ageMs: number | null) {
  const source = upsertDefaultSource(db, {
    host: HOST,
    link_calendario_id: `613b9237d969e100173d41${String(n).padStart(2, '0')}`,
    title: `Source ${n}`,
    title_en: null,
    group_path: null,
    program: 'Test',
  });
  if (ageMs !== null) {
    saveCachedCourses(db, source.id, []);
    db.prepare('UPDATE course_cache SET fetched_at = ? WHERE source_id = ?').run(Date.now() - ageMs, source.id);
  }
  return source;
}

describe('warmCourses', () => {
  it('rebuilds missing and aging lists, never-built first, and skips fresh ones', async () => {
    const db = openDb(':memory:');
    const fresh = addDefault(db, 10, 1 * DAY_MS);
    const aging = addDefault(db, 11, 6.5 * DAY_MS);
    const missing = addDefault(db, 12, null);
    insertSource(db, {
      kind: 'custom',
      host: HOST,
      link_calendario_id: '613b9237d969e100173d4199',
      title: 'Custom',
      title_en: null,
      created_by: null,
    });

    const built = await warmCourses(db, log, 0);

    expect(built).toBe(2);
    const builtIds = getEventsMock.mock.calls.map((call) => call[1].id);
    expect(builtIds).toEqual([missing.id, aging.id]);
    expect(builtIds).not.toContain(fresh.id);
  });

  it('keeps going when one source fails', async () => {
    const db = openDb(':memory:');
    const first = addDefault(db, 20, null);
    addDefault(db, 21, null);
    getEventsMock.mockImplementation(async (_db, source) => {
      if (source.id === first.id) throw new Error('upstream down');
      return [];
    });

    const built = await warmCourses(db, log, 0);

    expect(built).toBe(1);
    expect(getEventsMock).toHaveBeenCalledTimes(2);
  });
});
