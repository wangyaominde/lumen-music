import type { FastifyPluginAsync } from 'fastify';
import {
  createUser, deleteUser, destroyAllSessionsForUser, listUsers, setUserPin,
  userById, type Role
} from '../auth.js';

export const userRoutes: FastifyPluginAsync = async (app) => {
  // (admin gate is enforced by the global preHandler in index.ts; we still
  // double-check here so a future refactor can't accidentally expose these.)
  function requireAdmin(req: any, reply: any): boolean {
    const me = req.user as { role?: string } | undefined;
    if (!me || me.role !== 'admin') {
      reply.code(403).send({ error: 'admin only' });
      return false;
    }
    return true;
  }

  app.get('/api/users', async (req, reply) => {
    if (!requireAdmin(req, reply)) return;
    return listUsers();
  });

  app.post<{ Body: { username: string; pin: string; role?: Role } }>('/api/users', async (req, reply) => {
    if (!requireAdmin(req, reply)) return;
    const { username, pin } = req.body ?? ({} as any);
    const role: Role = req.body?.role === 'admin' ? 'admin' : 'listener';
    try {
      const user = createUser(String(username ?? '').trim(), String(pin ?? ''), role);
      return { ok: true, user };
    } catch (e) {
      return reply.code(400).send({ error: (e as Error).message });
    }
  });

  app.delete<{ Params: { id: string } }>('/api/users/:id', async (req, reply) => {
    if (!requireAdmin(req, reply)) return;
    const me = (req as any).user as { id: number };
    const id = Number(req.params.id);
    if (id === me.id) return reply.code(400).send({ error: '不能删除自己' });
    const target = userById(id);
    if (!target) return reply.code(404).send({ error: 'user not found' });
    deleteUser(id);
    return { ok: true };
  });

  app.post<{ Params: { id: string }; Body: { pin: string } }>('/api/users/:id/pin', async (req, reply) => {
    if (!requireAdmin(req, reply)) return;
    const id = Number(req.params.id);
    const target = userById(id);
    if (!target) return reply.code(404).send({ error: 'user not found' });
    try {
      setUserPin(id, String(req.body?.pin ?? ''));
      destroyAllSessionsForUser(id); // force re-login for that user
      return { ok: true };
    } catch (e) {
      return reply.code(400).send({ error: (e as Error).message });
    }
  });
};
