import { createHash, randomBytes } from 'node:crypto';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { env } from '../env.ts';

// Minimal, dependency-free Google OAuth 2.0 Authorization Code + PKCE flow.
// (Not using the `arctic` package: as of writing, it and its @oslojs/*
// dependencies were pulled from npm with a "no longer supported / contact
// support" notice, which reads as a registry-side security action rather
// than a routine handoff. Not something to pull into an auth code path.)
export const OAUTH_COOKIE = 'oauth';

const AUTH_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';
const USERINFO_ENDPOINT = 'https://openidconnect.googleapis.com/v1/userinfo';

function redirectUri(): string {
  return `${env.baseUrl}/api/auth/google/callback`;
}

function base64url(buf: Buffer): string {
  return buf.toString('base64url');
}

export class GoogleAuthError extends Error {}

export function startGoogleLogin(reply: FastifyReply): string {
  const state = base64url(randomBytes(24));
  const codeVerifier = base64url(randomBytes(48));
  const codeChallenge = base64url(createHash('sha256').update(codeVerifier).digest());

  const url = new URL(AUTH_ENDPOINT);
  url.searchParams.set('client_id', env.googleClientId);
  url.searchParams.set('redirect_uri', redirectUri());
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', 'openid email profile');
  url.searchParams.set('state', state);
  url.searchParams.set('code_challenge', codeChallenge);
  url.searchParams.set('code_challenge_method', 'S256');
  // Avoids silently picking whichever Google account is already signed in
  url.searchParams.set('prompt', 'select_account');

  reply.setCookie(OAUTH_COOKIE, JSON.stringify({ state, codeVerifier }), {
    httpOnly: true,
    secure: env.secureCookies,
    sameSite: 'lax',
    path: '/api/auth/google',
    maxAge: 600,
  });
  return url.toString();
}

export interface GoogleProfile {
  sub: string;
  email: string;
  name: string;
  pictureUrl: string | null;
}

function safeHttpsUrl(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' ? url.toString() : null;
  } catch {
    return null;
  }
}

interface TokenResponse {
  access_token?: string;
  error?: string;
  error_description?: string;
}

export async function completeGoogleLogin(req: FastifyRequest): Promise<GoogleProfile> {
  const query = req.query as { code?: string; state?: string };
  const stored = req.cookies[OAUTH_COOKIE];
  if (!stored || !query.code || !query.state) throw new GoogleAuthError('Missing OAuth parameters');

  let saved: { state: string; codeVerifier: string };
  try {
    saved = JSON.parse(stored);
  } catch {
    throw new GoogleAuthError('Invalid OAuth cookie');
  }
  if (saved.state !== query.state) throw new GoogleAuthError('State mismatch');

  const tokenRes = await fetch(TOKEN_ENDPOINT, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: env.googleClientId,
      client_secret: env.googleClientSecret,
      code: query.code,
      code_verifier: saved.codeVerifier,
      redirect_uri: redirectUri(),
      grant_type: 'authorization_code',
    }),
  });
  const tokenBody = (await tokenRes.json().catch(() => ({}))) as TokenResponse;
  if (!tokenRes.ok || !tokenBody.access_token) {
    throw new GoogleAuthError(`Token exchange failed: ${tokenBody.error_description || tokenBody.error || tokenRes.status}`);
  }

  const profileRes = await fetch(USERINFO_ENDPOINT, {
    headers: { authorization: `Bearer ${tokenBody.access_token}` },
  });
  if (!profileRes.ok) throw new GoogleAuthError('Could not fetch Google profile');
  const profile = (await profileRes.json()) as {
    sub?: string;
    email?: string;
    name?: string;
    email_verified?: boolean;
    picture?: string;
  };
  if (!profile.sub || !profile.email) throw new GoogleAuthError('Incomplete Google profile');
  if (profile.email_verified === false) throw new GoogleAuthError('Email not verified');

  return {
    sub: profile.sub,
    email: profile.email,
    name: profile.name || profile.email,
    pictureUrl: safeHttpsUrl(profile.picture),
  };
}
