import { randomBytes, scrypt, scryptSync, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { db } from './db.js';

const scryptAsync = promisify(scrypt) as (
  password: string,
  salt: Buffer,
  keylen: number,
  options: { N: number; r: number; p: number }
) => Promise<Buffer>;

const SCRYPT_N = 1 << 14;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const KEY_LEN = 64;

export const SESSION_COOKIE = 'lumen_session';

export type Role = 'admin' | 'listener';

export interface User {
  id: number;
  username: string;
  role: Role;
  created_at: number;
  updated_at: number;
}

// --- password hashing ---

export function hashPassword(password: string): string {
  if (!password || password.length < 4) throw new Error('PIN 至少 4 位');
  const salt = randomBytes(16);
  const key = scryptSync(password, salt, KEY_LEN, { N: SCRYPT_N, r: SCRYPT_R, p: SCRYPT_P });
  return `scrypt:${SCRYPT_N}:${SCRYPT_R}:${SCRYPT_P}:${salt.toString('hex')}:${key.toString('hex')}`;
}

function parseStoredHash(stored: string): { N: number; r: number; p: number; salt: Buffer; expected: Buffer } | null {
  try {
    const [scheme, nStr, rStr, pStr, saltHex, keyHex] = stored.split(':');
    if (scheme !== 'scrypt') return null;
    return {
      N: Number(nStr),
      r: Number(rStr),
      p: Number(pStr),
      salt: Buffer.from(saltHex, 'hex'),
      expected: Buffer.from(keyHex, 'hex')
    };
  } catch {
    return null;
  }
}

export function verifyPassword(password: string, stored: string): boolean {
  const parsed = parseStoredHash(stored);
  if (!parsed) return false;
  try {
    const got = scryptSync(password, parsed.salt, parsed.expected.length, { N: parsed.N, r: parsed.r, p: parsed.p });
    return got.length === parsed.expected.length && timingSafeEqual(got, parsed.expected);
  } catch {
    return false;
  }
}

// Login-path variant: scrypt runs on the libuv threadpool instead of blocking
// the event loop (~35ms per user with the sync version — enough to stutter
// concurrent audio streaming while someone logs in).
export async function verifyPasswordAsync(password: string, stored: string): Promise<boolean> {
  const parsed = parseStoredHash(stored);
  if (!parsed) return false;
  try {
    const got = await scryptAsync(password, parsed.salt, parsed.expected.length, { N: parsed.N, r: parsed.r, p: parsed.p });
    return got.length === parsed.expected.length && timingSafeEqual(got, parsed.expected);
  } catch {
    return false;
  }
}

// --- users ---

export function isConfigured(): boolean {
  return !!db.prepare('SELECT 1 FROM users LIMIT 1').get();
}

export function userById(id: number): User | undefined {
  return db.prepare('SELECT id, username, role, created_at, updated_at FROM users WHERE id = ?').get(id) as User | undefined;
}

export function userByUsername(username: string): User | undefined {
  return db.prepare('SELECT id, username, role, created_at, updated_at FROM users WHERE username = ?').get(username) as User | undefined;
}

export function listUsers(): User[] {
  return db.prepare('SELECT id, username, role, created_at, updated_at FROM users ORDER BY id').all() as User[];
}

export function userCount(): number {
  return (db.prepare('SELECT COUNT(*) AS c FROM users').get() as { c: number }).c;
}

/**
 * Find which user a PIN belongs to. Iterates all users and timing-safe verifies
 * against each. With personal-scale user bases (< 100) this is fine — ~50ms per
 * scrypt verify, off the event loop. For larger bases we'd add a cheap
 * deterministic index.
 *
 * Iterating in random order would give better timing-attack resistance, but
 * since each verify is constant-time and we always finish the loop, the
 * observable timing is roughly the same regardless of which user matched.
 */
export async function findUserByPin(pin: string): Promise<User | null> {
  if (!pin) return null;
  const rows = db.prepare(
    'SELECT id, username, role, password_hash, created_at, updated_at FROM users'
  ).all() as Array<User & { password_hash: string }>;
  let match: User | null = null;
  for (const r of rows) {
    const ok = await verifyPasswordAsync(pin, r.password_hash);
    if (ok && !match) {
      const { password_hash: _, ...u } = r;
      match = u;
      // keep iterating to even out timing
    }
  }
  return match;
}

// Blocking twin of findUserByPin for the rare synchronous admin paths below
// (PIN-collision checks on user creation / PIN change); login must use the
// async findUserByPin.
function findUserByPinSync(pin: string): User | null {
  if (!pin) return null;
  const rows = db.prepare(
    'SELECT id, username, role, password_hash, created_at, updated_at FROM users'
  ).all() as Array<User & { password_hash: string }>;
  let match: User | null = null;
  for (const r of rows) {
    const ok = verifyPassword(pin, r.password_hash);
    if (ok && !match) {
      const { password_hash: _, ...u } = r;
      match = u;
    }
  }
  return match;
}

export function createUser(username: string, pin: string, role: Role): User {
  if (!username) throw new Error('用户名不能为空');
  if (username.length < 1 || username.length > 32) throw new Error('用户名长度需在 1-32 之间');
  if (userByUsername(username)) throw new Error('该用户名已存在');
  // Collisions of PINs are not allowed — login lookup is by PIN alone.
  if (findUserByPinSync(pin)) throw new Error('该 PIN 已被使用，请换一个');
  const hash = hashPassword(pin);
  const now = Date.now();
  const r = db.prepare(
    'INSERT INTO users (username, password_hash, role, created_at, updated_at) VALUES (?, ?, ?, ?, ?)'
  ).run(username, hash, role, now, now);
  return userById(Number(r.lastInsertRowid))!;
}

export function setUserPin(userId: number, pin: string) {
  // Make sure the new PIN doesn't collide with any other user.
  const existing = findUserByPinSync(pin);
  if (existing && existing.id !== userId) throw new Error('该 PIN 已被使用，请换一个');
  const hash = hashPassword(pin);
  db.prepare('UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?').run(hash, Date.now(), userId);
}

export function deleteUser(userId: number) {
  // sessions cascade on FK
  db.prepare('DELETE FROM users WHERE id = ?').run(userId);
}

// --- sessions ---

export function createSession(userId: number, userAgent?: string): string {
  const token = randomBytes(32).toString('hex');
  const now = Date.now();
  db.prepare('INSERT INTO sessions (token, user_id, created_at, last_seen, user_agent) VALUES (?, ?, ?, ?, ?)').run(
    token, userId, now, now, userAgent ?? null
  );
  return token;
}

export function userBySession(token: string | undefined): User | null {
  if (!token) return null;
  const row = db.prepare(`
    SELECT u.id, u.username, u.role, u.created_at, u.updated_at
    FROM sessions s JOIN users u ON u.id = s.user_id
    WHERE s.token = ?
  `).get(token) as User | undefined;
  if (!row) return null;
  const oneHour = 60 * 60 * 1000;
  db.prepare('UPDATE sessions SET last_seen = ? WHERE token = ? AND last_seen < ?')
    .run(Date.now(), token, Date.now() - oneHour);
  return row;
}

export function destroySession(token: string | undefined) {
  if (!token) return;
  db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
}

export function destroyAllSessionsForUser(userId: number) {
  db.prepare('DELETE FROM sessions WHERE user_id = ?').run(userId);
}

// --- brute-force throttle ---

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
  const ladder = [0, 1000, 2000, 5000, 10000, 30000, 60000];
  const wait = ladder[Math.min(a.count, ladder.length - 1)];
  a.until = Date.now() + wait;
  attempts.set(key, a);
}

export function loginAttemptSucceeded(key: string) {
  attempts.delete(key);
}
