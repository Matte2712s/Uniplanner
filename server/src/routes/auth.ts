import type { FastifyInstance } from 'fastify';
import type { MeDto } from '@planner/shared';
import type { Db } from '../db/index.ts';
import { upsertUser } from '../db/repo.ts';
import { completeGoogleLogin, GoogleAuthError, startGoogleLogin } from '../auth/google.ts';
import { clearSession, currentUser, issueSession } from '../auth/session.ts';
import { env, googleEnabled, isAdminEmail } from '../env.ts';

export function registerAuthRoutes(app: FastifyInstance, db: Db): void {
  // GET /api/auth/google
  app.get('/api/auth/google', async (req, reply) => {
    if (!googleEnabled) return reply.code(503).send({ error: 'google_oauth_not_configured' });
    return reply.redirect(startGoogleLogin(reply));
  });

  // GET /api/auth/google/callback
  app.get('/api/auth/google/callback', async (req, reply) => {
    if (!googleEnabled) return reply.code(503).send({ error: 'google_oauth_not_configured' });
    try {
      const profile = await completeGoogleLogin(req);
      const user = upsertUser(db, profile.sub, profile.email, profile.name, profile.pictureUrl);
      reply.clearCookie('oauth', { path: '/api/auth/google' });
      issueSession(db, reply, user.id);
      return reply.redirect(env.baseUrl);
    } catch (err) {
      req.log.warn({ err }, 'google login failed');
      const message = err instanceof GoogleAuthError ? err.message : 'login_failed';
      return reply.redirect(`${env.baseUrl}/?authError=${encodeURIComponent(message)}`);
    }
  });

  if (env.devLogin) {
    // POST /api/auth/dev-login (local testing only, never enabled in production)
    app.post('/api/auth/dev-login', async (req, reply) => {
      const body = req.body as { email?: string; name?: string };
      const email = (body.email || '').trim().toLowerCase();
      if (!email || !email.includes('@')) return reply.code(400).send({ error: 'invalid_email' });
      const user = upsertUser(db, `dev:${email}`, email, body.name?.trim() || email);
      issueSession(db, reply, user.id);
      return {
        id: user.id,
        email: user.email,
        name: user.name,
        pictureUrl: user.picture_url,
        isAdmin: isAdminEmail(user.email),
      } satisfies MeDto;
    });
  }

  // POST /api/auth/logout
  app.post('/api/auth/logout', async (req, reply) => {
    clearSession(db, req, reply);
    return { ok: true };
  });

  // GET /api/me
  app.get('/api/me', async (req, reply) => {
    const user = currentUser(db, req, reply);
    if (!user) return reply.code(200).send(null);
    return {
      id: user.id,
      email: user.email,
      name: user.name,
      pictureUrl: user.picture_url,
      isAdmin: isAdminEmail(user.email),
    } satisfies MeDto;
  });
}
