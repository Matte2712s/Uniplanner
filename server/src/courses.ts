import type { FastifyBaseLogger } from 'fastify';
import { COURSES_LOOKAHEAD_DAYS, COURSES_LOOKBACK_DAYS, type CourseDto } from '@planner/shared';
import type { Db } from './db/index.ts';
import { getCachedCourses, saveCachedCourses, type SourceRow } from './db/repo.ts';
import { coursesFromEvents } from './cineca/normalize.ts';
import { getEventsForSource, SourceDownError } from './cineca/service.ts';
import { createLimiter } from './limiter.ts';

const DAY_MS = 24 * 60 * 60 * 1000;

// Freshness target: an older list is still served, but rebuilt in the background
export const COURSES_FRESH_MS = 7 * DAY_MS;
// Hard limit: an older list is rebuilt before answering
export const COURSES_MAX_AGE_MS = 60 * DAY_MS;
// A manual refresh right after a build is ignored, to blunt abuse
const REFRESH_MIN_AGE_MS = 60 * 1000;
// After a background refresh attempt, wait before trying that source again
const REVALIDATE_RETRY_MS = 15 * 60 * 1000;

// Each build costs ~58 upstream fetches; queue them so a burst (a whole folder
// of sources) finishes a few at a time instead of all crawling together
const BUILD_CONCURRENCY = 3;
const queueBuild = createLimiter(BUILD_CONCURRENCY);
const builds = new Map<string, Promise<CourseDto[]>>();
const lastRevalidate = new Map<number, number>();

// After a build fails completely, fail further attempts at once for a while: a
// dead or hung calendar would otherwise cost a full round of upstream timeouts
// (~30s) on every client retry
const DOWN_COOLDOWN_MS = 2 * 60 * 1000;
const downSources = new Map<number, { until: number; error: SourceDownError }>();

function activeDownError(sourceId: number): SourceDownError | undefined {
  const down = downSources.get(sourceId);
  if (!down) return undefined;
  if (Date.now() >= down.until) {
    downSources.delete(sourceId);
    return undefined;
  }
  return down.error;
}

export type CourseSource = Pick<SourceRow, 'id' | 'host' | 'link_calendario_id'>;

/** Window the course list is built from: the same span the client requests. */
export function courseWindow(now = Date.now()): { from: Date; to: Date } {
  return {
    from: new Date(now - COURSES_LOOKBACK_DAYS * DAY_MS),
    to: new Date(now + COURSES_LOOKAHEAD_DAYS * DAY_MS),
  };
}

/** Builds and caches a course list. Callers share one build per source; builds run through the queue. */
export function buildCourses(
  db: Db,
  source: CourseSource,
  range: { from: Date; to: Date },
  refresh: boolean,
): Promise<CourseDto[]> {
  const down = activeDownError(source.id);
  if (down) return Promise.reject(down);

  const key = `${source.id}:${refresh}`;
  let build = builds.get(key);
  if (!build) {
    build = queueBuild(async () => {
      // Went down while this build waited in the queue
      const nowDown = activeDownError(source.id);
      if (nowDown) throw nowDown;
      try {
        const events = await getEventsForSource(
          db,
          { id: source.id, host: source.host, linkCalendarioId: source.link_calendario_id },
          range.from,
          range.to,
          refresh,
        );
        const built = coursesFromEvents(source.id, events);
        saveCachedCourses(db, source.id, built);
        downSources.delete(source.id);
        return built;
      } catch (err) {
        if (err instanceof SourceDownError) downSources.set(source.id, { until: Date.now() + DOWN_COOLDOWN_MS, error: err });
        throw err;
      }
    }).finally(() => builds.delete(key));
    builds.set(key, build);
  }
  return build;
}

function refreshInBackground(db: Db, source: CourseSource, log: FastifyBaseLogger): void {
  const now = Date.now();
  if (now - (lastRevalidate.get(source.id) ?? 0) < REVALIDATE_RETRY_MS) return;
  lastRevalidate.set(source.id, now);
  buildCourses(db, source, courseWindow(now), false).catch((err) =>
    log.warn({ err, sourceId: source.id }, 'background course refresh failed'),
  );
}

/**
 * Returns a source's course list, waiting for a build only when there is no
 * usable cache. A list past the freshness target is served as is while a
 * rebuild runs in the background.
 */
export async function loadCourses(
  db: Db,
  source: CourseSource,
  opts: { from: Date; to: Date; refresh: boolean },
  log: FastifyBaseLogger,
): Promise<CourseDto[]> {
  const cached = getCachedCourses(db, source.id);
  const age = cached ? Date.now() - cached.fetchedAt : Infinity;

  if (opts.refresh) {
    if (cached && age < REFRESH_MIN_AGE_MS) return cached.courses;
    return buildCourses(db, source, opts, true);
  }
  if (cached && age <= COURSES_MAX_AGE_MS) {
    if (age > COURSES_FRESH_MS) refreshInBackground(db, source, log);
    return cached.courses;
  }
  return buildCourses(db, source, opts, false);
}
