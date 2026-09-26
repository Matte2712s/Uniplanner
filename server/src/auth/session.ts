import { createHash, randomBytes } from 'node:crypto';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { Db } from '../db/index.ts';
import { createSession, deleteSession, getSession, getUserById, touchSession, type UserRow } from '../db/repo.ts';
import { env } from '../env.ts';

export const SESSION_COOKIE = 'session';
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function issueSession(db: Db, reply: FastifyReply, userId: number): void {
  const token = randomBytes(32).toString('base64url');
  const expiresAt = Date.now() + SESSION_TTL_MS;
  createSession(db, hashToken(token), userId, expiresAt);
  reply.setCookie(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: env.secureCookies,
    sameSite: 'lax',
    path: '/',
    maxAge: SESSION_TTL_MS / 1000,
  });
}

export function clearSession(db: Db, req: FastifyRequest, reply: FastifyReply): void {
  const token = req.cookies[SESSION_COOKIE];
  if (token) deleteSession(db, hashToken(token));
  reply.clearCookie(SESSION_COOKIE, { path: '/' });
}

export function currentUser(db: Db, req: FastifyRequest, reply: FastifyReply): UserRow | undefined {
  const token = req.cookies[SESSION_COOKIE];
  if (!token) return undefined;
  const hash = hashToken(token);
  const session = getSession(db, hash);
  if (!session || session.expires_at < Date.now()) return undefined;

  // Rolling window: active users never get logged out. Only rewritten once
  // the session is more than half-expired, so a busy user isn't hitting the
  // DB and resetting the cookie on every single request.
  const remainingMs = session.expires_at - Date.now();
  if (remainingMs < SESSION_TTL_MS / 2) {
    const expiresAt = Date.now() + SESSION_TTL_MS;
    touchSession(db, hash, expiresAt);
    reply.setCookie(SESSION_COOKIE, token, {
      httpOnly: true,
      secure: env.secureCookies,
      sameSite: 'lax',
      path: '/',
      maxAge: SESSION_TTL_MS / 1000,
    });
  }

  return getUserById(db, session.user_id);
}

export function requireUser(db: Db, req: FastifyRequest, reply: FastifyReply): UserRow | undefined {
  const user = currentUser(db, req, reply);
  if (!user) {
    reply.code(401).send({ error: 'unauthenticated' });
    return undefined;
  }
  return user;
}
