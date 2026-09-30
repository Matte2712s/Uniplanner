import type { FastifyBaseLogger } from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { openDb } from '../src/db/index.ts';
import { getCachedCourses, insertSource, saveCachedCourses } from '../src/db/repo.ts';

const getEventsMock = vi.fn();
vi.mock('../src/cineca/service.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/cineca/service.ts')>();
  return { ...actual, getEventsForSource: getEventsMock };
});

const DAY_MS = 24 * 60 * 60 * 1000;
const OLD_LIST = [{ key: 'OLD', code: 'OLD', name: 'Old course', nameEn: null, partition: null }];
const range = () => ({ from: new Date(), to: new Date(Date.now() + DAY_MS) });

let loadCourses: typeof import('../src/courses.ts').loadCourses;
let SourceDownError: typeof import('../src/cineca/service.ts').SourceDownError;
let SourceUnavailableError: typeof import('../src/cineca/service.ts').SourceUnavailableError;
let log: { warn: ReturnType<typeof vi.fn> };

beforeEach(async () => {
  // Fresh module state (background refresh throttle, shared builds) per test
  vi.resetModules();
  getEventsMock.mockReset();
  getEventsMock.mockResolvedValue([]);
  ({ loadCourses } = await import('../src/courses.ts'));
  // Same registry as courses.ts, so instanceof matches
  ({ SourceDownError, SourceUnavailableError } = await import('../src/cineca/service.ts'));
  log = { warn: vi.fn() };
});

afterEach(() => {
  vi.useRealTimers();
});

function setup(ageMs: number | null) {
  const db = openDb(':memory:');
  const source = insertSource(db, {
    kind: 'default',
    host: 'unito.prod.up.cineca.it',
    link_calendario_id: '613b9237d969e100173d4110',
    title: 'Canale A',
    title_en: null,
    created_by: null,
  });
  if (ageMs !== null) {
    saveCachedCourses(db, source.id, OLD_LIST);
    db.prepare('UPDATE course_cache SET fetched_at = ? WHERE source_id = ?').run(Date.now() - ageMs, source.id);
  }
  return { db, source };
}

const load = (db: ReturnType<typeof openDb>, source: { id: number; host: string; link_calendario_id: string }, refresh = false) =>
  loadCourses(db, source, { ...range(), refresh }, log as unknown as FastifyBaseLogger);

describe('loadCourses', () => {
  it('serves a fresh list without building', async () => {
    const { db, source } = setup(1 * DAY_MS);
    await expect(load(db, source)).resolves.toEqual(OLD_LIST);
    expect(getEventsMock).not.toHaveBeenCalled();
  });

  it('serves a stale list at once and rebuilds it in the background', async () => {
    const { db, source } = setup(10 * DAY_MS);
    await expect(load(db, source)).resolves.toEqual(OLD_LIST);

    await vi.waitFor(() => expect(getCachedCourses(db, source.id)?.courses).toEqual([]));
    expect(getEventsMock).toHaveBeenCalledTimes(1);
  });

  it('waits for a rebuild once the list passes the hard limit', async () => {
    const { db, source } = setup(61 * DAY_MS);
    await expect(load(db, source)).resolves.toEqual([]);
    expect(getEventsMock).toHaveBeenCalledTimes(1);
  });

  it('builds when there is no cache', async () => {
    const { db, source } = setup(null);
    await expect(load(db, source)).resolves.toEqual([]);
    expect(getEventsMock).toHaveBeenCalledTimes(1);
  });

  it('does not retry a failing background refresh right away', async () => {
    const { db, source } = setup(10 * DAY_MS);
    getEventsMock.mockRejectedValue(new Error('upstream down'));

    await load(db, source);
    await vi.waitFor(() => expect(log.warn).toHaveBeenCalledTimes(1));
    await load(db, source);
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(getEventsMock).toHaveBeenCalledTimes(1);
    expect(log.warn).toHaveBeenCalledTimes(1);
    expect(getCachedCourses(db, source.id)?.courses).toEqual(OLD_LIST);
  });

  it('fails at once for a source that just went down, then retries after the cooldown', async () => {
    const { db, source } = setup(null);
    getEventsMock.mockRejectedValue(new SourceDownError('Cannot load events: timeout'));

    await expect(load(db, source)).rejects.toBeInstanceOf(SourceDownError);
    await expect(load(db, source)).rejects.toBeInstanceOf(SourceDownError);
    expect(getEventsMock).toHaveBeenCalledTimes(1);

    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(Date.now() + 3 * 60 * 1000);
    getEventsMock.mockResolvedValue([]);
    await expect(load(db, source)).resolves.toEqual([]);
    expect(getEventsMock).toHaveBeenCalledTimes(2);
  });

  it('keeps retrying after a partial failure', async () => {
    const { db, source } = setup(null);
    getEventsMock.mockRejectedValue(new SourceUnavailableError('Cannot load events: flaky'));

    await expect(load(db, source)).rejects.toBeInstanceOf(SourceUnavailableError);
    await expect(load(db, source)).rejects.toBeInstanceOf(SourceUnavailableError);
    expect(getEventsMock).toHaveBeenCalledTimes(2);
  });

  it('ignores a manual refresh right after a build', async () => {
    const { db, source } = setup(10 * 1000);
    await expect(load(db, source, true)).resolves.toEqual(OLD_LIST);
    expect(getEventsMock).not.toHaveBeenCalled();
  });

  it('honors a manual refresh on an older list', async () => {
    const { db, source } = setup(2 * 60 * 1000);
    await expect(load(db, source, true)).resolves.toEqual([]);
    expect(getEventsMock).toHaveBeenCalledTimes(1);
    expect(getEventsMock.mock.calls[0]![4]).toBe(true);
  });
});
