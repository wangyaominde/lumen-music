import type { FastifyPluginAsync } from 'fastify';
import {
  SESSION_COOKIE, createSession, createUser, destroySession, findUserByPin,
  isConfigured, loginAttemptFailed, loginAttemptSucceeded, loginThrottleCheck,
  setUserPin, userBySession, userById
} from '../auth.js';

const COOKIE_MAX_AGE = 60 * 60 * 24 * 30; // 30 days
const isProd = process.env.NODE_ENV === 'production';

function setSessionCookie(reply: any, token: string) {
  reply.setCookie(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: isProd,
    path: '/',
    maxAge: COOKIE_MAX_AGE
  });
}

function clearSessionCookie(reply: any) {
  reply.clearCookie(SESSION_COOKIE, { path: '/' });
}

export const authRoutes: FastifyPluginAsync = async (app) => {
  app.get('/api/auth/status', async (req) => {
    const token = (req as any).cookies?.[SESSION_COOKIE];
    const user = userBySession(token);
    return {
      configured: isConfigured(),
      authenticated: !!user,
      user: user ? { id: user.id, username: user.username, role: user.role } : null
    };
  });

  app.post<{ Body: { pin: string; username?: string } }>('/api/auth/setup', async (req, reply) => {
    if (isConfigured()) return reply.code(409).send({ error: '已存在管理员账号，请直接登录' });
    const pin = String(req.body?.pin ?? '');
    const username = String(req.body?.username ?? 'admin').trim() || 'admin';
    try {
      const user = createUser(username, pin, 'admin');
      const token = createSession(user.id, req.headers['user-agent']);
      setSessionCookie(reply, token);
      return { ok: true, user: { id: user.id, username: user.username, role: user.role } };
    } catch (e) {
      return reply.code(400).send({ error: (e as Error).message });
    }
  });

  app.post<{ Body: { pin: string } }>('/api/auth/login', async (req, reply) => {
    if (!isConfigured()) return reply.code(409).send({ error: '请先设置管理员', needsSetup: true });
    const ip = (req.ip || req.headers['x-forwarded-for'] || 'unknown') as string;
    const throttle = loginThrottleCheck(ip);
    if (!throttle.ok) {
      reply.header('Retry-After', Math.ceil(throttle.retryAfterMs / 1000));
      return reply.code(429).send({ error: '请稍后再试', retryAfterMs: throttle.retryAfterMs });
    }
    const pin = String(req.body?.pin ?? '');
    const user = await findUserByPin(pin);
    if (!user) {
      loginAttemptFailed(ip);
      return reply.code(401).send({ error: 'PIN 错误' });
    }
    loginAttemptSucceeded(ip);
    const token = createSession(user.id, req.headers['user-agent']);
    setSessionCookie(reply, token);
    return { ok: true, user: { id: user.id, username: user.username, role: user.role } };
  });

  app.post('/api/auth/logout', async (req, reply) => {
    const token = (req as any).cookies?.[SESSION_COOKIE];
    destroySession(token);
    clearSessionCookie(reply);
    return { ok: true };
  });

  // Change own PIN
  app.post<{ Body: { current: string; next: string } }>('/api/auth/pin', async (req, reply) => {
    const me = (req as any).user as { id: number } | undefined;
    if (!me) return reply.code(401).send({ error: 'unauthorized' });
    const cur = String(req.body?.current ?? '');
    const nxt = String(req.body?.next ?? '');
    // Verify current PIN belongs to current user
    const user = await findUserByPin(cur);
    if (!user || user.id !== me.id) return reply.code(401).send({ error: '当前 PIN 错误' });
    try {
      setUserPin(me.id, nxt);
      return { ok: true };
    } catch (e) {
      return reply.code(400).send({ error: (e as Error).message });
    }
  });
};
