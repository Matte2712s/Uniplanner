import type { FastifyBaseLogger } from 'fastify';
import type { Db } from './db/index.ts';
import { courseCacheBuildTimes, defaultSources } from './db/repo.ts';
import { buildCourses, courseWindow, COURSES_FRESH_MS } from './courses.ts';

const PASS_INTERVAL_MS = 24 * 60 * 60 * 1000;
const START_DELAY_MS = 30 * 1000;
// Gentle on Cineca: one source at a time, with a pause between
const PAUSE_MS = 10 * 1000;
// Rebuild before a list crosses the freshness target, so users never get a stale one
const REFRESH_AFTER_MS = COURSES_FRESH_MS - PASS_INTERVAL_MS;

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Rebuilds missing or aging course lists of default sources, never-built and oldest first. */
export async function warmCourses(db: Db, log: FastifyBaseLogger, pauseMs = PAUSE_MS, now = Date.now()): Promise<number> {
  const builtAt = courseCacheBuildTimes(db);
  const todo = defaultSources(db)
    .map((source) => ({ source, age: now - (builtAt.get(source.id) ?? 0) }))
    .filter((entry) => entry.age > REFRESH_AFTER_MS)
    .sort((a, b) => b.age - a.age);

  let built = 0;
  for (const { source } of todo) {
    try {
      await buildCourses(db, source, courseWindow(), false);
      built += 1;
    } catch (err) {
      log.warn({ err, sourceId: source.id }, 'course warm failed, will retry next pass');
    }
    await sleep(pauseMs);
  }
  log.info({ built, queued: todo.length }, 'course warm pass done');
  return built;
}

export function startCourseWarmer(db: Db, log: FastifyBaseLogger): void {
  let running = false;
  const pass = async () => {
    if (running) return;
    running = true;
    try {
      await warmCourses(db, log);
    } catch (err) {
      log.error({ err }, 'course warm pass crashed');
    } finally {
      running = false;
    }
  };
  setTimeout(() => void pass(), START_DELAY_MS).unref();
  setInterval(() => void pass(), PASS_INTERVAL_MS).unref();
}
