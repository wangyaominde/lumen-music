import type { FastifyPluginAsync } from 'fastify';
import {
  SESSION_COOKIE, checkPassword, createSession, destroySession, isConfigured,
  loginAttemptFailed, loginAttemptSucceeded, loginThrottleCheck, setPassword, validateSession
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
    return {
      configured: isConfigured(),
      authenticated: validateSession(token)
    };
  });

  app.post<{ Body: { password: string } }>('/api/auth/setup', async (req, reply) => {
    if (isConfigured()) return reply.code(409).send({ error: '密码已设置，请直接登录' });
    const password = String(req.body?.password ?? '');
    if (password.length < 4) return reply.code(400).send({ error: '密码至少 4 位' });
    setPassword(password);
    const token = createSession(req.headers['user-agent']);
    setSessionCookie(reply, token);
    return { ok: true };
  });

  app.post<{ Body: { password: string } }>('/api/auth/login', async (req, reply) => {
    if (!isConfigured()) return reply.code(409).send({ error: '请先设置密码', needsSetup: true });
    const ip = (req.ip || req.headers['x-forwarded-for'] || 'unknown') as string;
    const throttle = loginThrottleCheck(ip);
    if (!throttle.ok) {
      reply.header('Retry-After', Math.ceil(throttle.retryAfterMs / 1000));
      return reply.code(429).send({ error: `请稍后再试`, retryAfterMs: throttle.retryAfterMs });
    }
    const password = String(req.body?.password ?? '');
    if (!checkPassword(password)) {
      loginAttemptFailed(ip);
      return reply.code(401).send({ error: '密码错误' });
    }
    loginAttemptSucceeded(ip);
    const token = createSession(req.headers['user-agent']);
    setSessionCookie(reply, token);
    return { ok: true };
  });

  app.post('/api/auth/logout', async (req, reply) => {
    const token = (req as any).cookies?.[SESSION_COOKIE];
    destroySession(token);
    clearSessionCookie(reply);
    return { ok: true };
  });

  app.post<{ Body: { current: string; next: string } }>('/api/auth/password', async (req, reply) => {
    if (!isConfigured()) return reply.code(409).send({ error: '尚未设置密码' });
    const cur = String(req.body?.current ?? '');
    const nxt = String(req.body?.next ?? '');
    if (!checkPassword(cur)) return reply.code(401).send({ error: '当前密码错误' });
    if (nxt.length < 4) return reply.code(400).send({ error: '新密码至少 4 位' });
    setPassword(nxt);
    return { ok: true };
  });
};
