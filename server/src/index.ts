import cookie from '@fastify/cookie';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import fastifyStatic from '@fastify/static';
import Fastify from 'fastify';
import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { openDb } from './db/index.ts';
import { purgeExpiredSessions } from './db/repo.ts';
import { env, googleEnabled } from './env.ts';
import { registerAuthRoutes } from './routes/auth.ts';
import { registerFolderRoutes } from './routes/folders.ts';
import { registerProgramRoutes } from './routes/programs.ts';
import { registerSourceRoutes } from './routes/sources.ts';
import { registerViewRoutes } from './routes/views.ts';
import { registerPrefsRoutes } from './routes/prefs.ts';
import { registerEventRoutes } from './routes/events.ts';
import { seedDefaultSources } from './seed.ts';

declare module 'node:http' {
  interface IncomingMessage {
    cspNonce?: string;
  }
}

const app = Fastify({ logger: true, trustProxy: true });
const db = openDb(env.databasePath);

await app.register(cookie);

// FullCalendar injects its own <style> tags at import time; give each
// request a nonce so that survives the strict CSP instead of needing
// 'unsafe-inline' (https://fullcalendar.io/docs/content-security-policy).
app.addHook('onRequest', async (req) => {
  req.raw.cspNonce = randomBytes(16).toString('base64');
});

await app.register(helmet, {
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", (req) => `'nonce-${req.cspNonce}'`],
      // https://*.googleusercontent.com: Google account profile pictures
      imgSrc: ["'self'", 'data:', 'https://*.googleusercontent.com'],
      connectSrc: ["'self'"],
      objectSrc: ["'none'"],
      frameAncestors: ["'none'"],
      baseUri: ["'none'"],
      formAction: ["'self'"],
    },
  },
});
await app.register(rateLimit, { max: 300, timeWindow: '1 minute' });

// CSRF defense in depth on top of SameSite=Lax cookies: reject any
// state-changing request whose Origin header does not match this app.
app.addHook('onRequest', async (req, reply) => {
  const method = req.method.toUpperCase();
  if (!req.url.startsWith('/api/') || !['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) return;
  const origin = req.headers.origin;
  if (origin && origin !== env.baseUrl) {
    reply.code(403).send({ error: 'bad_origin' });
  }
});

registerAuthRoutes(app, db);
registerSourceRoutes(app, db);
registerFolderRoutes(app, db);
registerProgramRoutes(app, db);
registerViewRoutes(app, db);
registerPrefsRoutes(app, db);
registerEventRoutes(app, db);

// GET /api/health
app.get('/api/health', async () => {
  db.prepare('SELECT 1').get();
  return { status: 'ok' };
});

const indexHtmlPath = path.join(env.webDist, 'index.html');

// Read fresh on every request (a cheap, small file) rather than caching it
// at startup - otherwise redeploying the web build without also restarting
// this process keeps serving old hashed asset filenames indefinitely.
function renderIndexHtml(nonce: string | undefined): string | null {
  if (!existsSync(indexHtmlPath)) return null;
  return readFileSync(indexHtmlPath, 'utf8').replace('<script type="module"', `<script nonce="${nonce}" type="module"`);
}

if (existsSync(indexHtmlPath)) {
  await app.register(fastifyStatic, { root: env.webDist, index: false });
  app.get('/', async (req, reply) => {
    const html = renderIndexHtml(req.raw.cspNonce);
    if (!html) return reply.code(404).send({ error: 'not_found' });
    reply.type('text/html').send(html);
  });
  app.setNotFoundHandler((req, reply) => {
    if (req.raw.url?.startsWith('/api/')) return reply.code(404).send({ error: 'not_found' });
    const html = renderIndexHtml(req.raw.cspNonce);
    if (!html) return reply.code(404).send({ error: 'not_found' });
    reply.type('text/html').send(html);
  });
} else {
  app.log.warn(`No web build at ${env.webDist}; run the web workspace in dev mode separately.`);
}

if (!googleEnabled) {
  app.log.warn('GOOGLE_CLIENT_ID/SECRET not set: Google login is disabled.' + (env.devLogin ? ' Using dev login.' : ''));
}

purgeExpiredSessions(db);
setInterval(() => purgeExpiredSessions(db), 60 * 60 * 1000).unref();

await seedDefaultSources(db, app.log);

await app.listen({ port: env.port, host: env.host });
