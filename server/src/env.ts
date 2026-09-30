import path from 'node:path';
import { fileURLToPath } from 'node:url';

const serverRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const projectRoot = path.resolve(serverRoot, '..');
const isProd = process.env.NODE_ENV === 'production';

const baseUrl = new URL(process.env.BASE_URL || 'http://localhost:5173');

if (isProd && baseUrl.protocol !== 'https:') {
  throw new Error('BASE_URL must be https in production');
}

export const env = {
  isProd,
  port: Number(process.env.PORT || 3000),
  host: process.env.HOST || '127.0.0.1',
  baseUrl: baseUrl.origin,
  secureCookies: baseUrl.protocol === 'https:',
  googleClientId: process.env.GOOGLE_CLIENT_ID || '',
  googleClientSecret: process.env.GOOGLE_CLIENT_SECRET || '',
  databasePath: path.resolve(projectRoot, process.env.DATABASE_PATH || './data/planner.db'),
  devLogin: !isProd && process.env.DEV_LOGIN === 'true',
  // Background course list refresh: on in production, opt-in elsewhere so dev restarts don't crawl Cineca
  warmCourses: process.env.WARM_COURSES ? process.env.WARM_COURSES === 'true' : isProd,
  sourcesConfigPath: path.resolve(serverRoot, 'config/sources.json'),
  webDist: path.resolve(projectRoot, 'web/dist'),
};

export const googleEnabled = Boolean(env.googleClientId && env.googleClientSecret);

const adminEmails = new Set(
  (process.env.ADMIN_EMAILS || '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean),
);

export function isAdminEmail(email: string): boolean {
  return adminEmails.has(email.trim().toLowerCase());
}
