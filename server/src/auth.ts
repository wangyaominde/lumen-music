import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { db } from './db.js';

const SCRYPT_N = 1 << 14; // CPU/memory cost
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const KEY_LEN = 64;

export function hashPassword(password: string): string {
  if (!password || password.length < 4) {
    throw new Error('password must be at least 4 characters');
  }
  const salt = randomBytes(16);
  const key = scryptSync(password, salt, KEY_LEN, { N: SCRYPT_N, r: SCRYPT_R, p: SCRYPT_P });
  return `scrypt:${SCRYPT_N}:${SCRYPT_R}:${SCRYPT_P}:${salt.toString('hex')}:${key.toString('hex')}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  try {
    const [scheme, nStr, rStr, pStr, saltHex, keyHex] = stored.split(':');
    if (scheme !== 'scrypt') return false;
    const N = Number(nStr), r = Number(rStr), p = Number(pStr);
    const salt = Buffer.from(saltHex, 'hex');
    const expected = Buffer.from(keyHex, 'hex');
    const got = scryptSync(password, salt, expected.length, { N, r, p });
    return got.length === expected.length && timingSafeEqual(got, expected);
  } catch {
    return false;
  }
}

export function isConfigured(): boolean {
  const row = db.prepare('SELECT 1 FROM auth WHERE id = 1').get();
  return !!row;
}

export function setPassword(password: string) {
  const hash = hashPassword(password);
  const now = Date.now();
  if (isConfigured()) {
    db.prepare('UPDATE auth SET password_hash = ?, updated_at = ? WHERE id = 1').run(hash, now);
  } else {
    db.prepare('INSERT INTO auth (id, password_hash, created_at, updated_at) VALUES (1, ?, ?, ?)').run(hash, now, now);
  }
}

export function checkPassword(password: string): boolean {
  const row = db.prepare('SELECT password_hash FROM auth WHERE id = 1').get() as { password_hash: string } | undefined;
  if (!row) return false;
  return verifyPassword(password, row.password_hash);
}

// --- sessions ---

export function createSession(userAgent?: string): string {
  const token = randomBytes(32).toString('hex');
  const now = Date.now();
  db.prepare('INSERT INTO sessions (token, created_at, last_seen, user_agent) VALUES (?, ?, ?, ?)').run(token, now, now, userAgent ?? null);
  return token;
}

export function validateSession(token: string | undefined): boolean {
  if (!token) return false;
  const row = db.prepare('SELECT token FROM sessions WHERE token = ?').get(token);
  if (!row) return false;
  // touch last_seen (not on every hit, only if older than 1h, to reduce writes)
  const oneHour = 60 * 60 * 1000;
  db.prepare('UPDATE sessions SET last_seen = ? WHERE token = ? AND last_seen < ?')
    .run(Date.now(), token, Date.now() - oneHour);
  return true;
}

export function destroySession(token: string | undefined) {
  if (!token) return;
  db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
}

// --- brute-force throttle (in-memory) ---

const attempts = new Map<string, { count: number; until: number }>();

export function loginThrottleCheck(key: string): { ok: true } | { ok: false; retryAfterMs: number } {
  const a = attempts.get(key);
  if (!a) return { ok: true };
  if (Date.now() < a.until) return { ok: false, retryAfterMs: a.until - Date.now() };
  return { ok: true };
}

export function loginAttemptFailed(key: string) {
  const a = attempts.get(key) ?? { count: 0, until: 0 };
  a.count += 1;
  // exponential cool-off: 1, 2, 5, 10, 30, 60s
  const ladder = [0, 1000, 2000, 5000, 10000, 30000, 60000];
  const wait = ladder[Math.min(a.count, ladder.length - 1)];
  a.until = Date.now() + wait;
  attempts.set(key, a);
}

export function loginAttemptSucceeded(key: string) {
  attempts.delete(key);
}

export const SESSION_COOKIE = 'lumen_session';
