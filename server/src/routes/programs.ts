import type { FastifyInstance } from 'fastify';
import type { Db } from '../db/index.ts';
import { addProgramForUser, defaultSources } from '../db/repo.ts';
import { requireUser } from '../auth/session.ts';

export function registerProgramRoutes(app: FastifyInstance, db: Db): void {
  // POST /api/programs/:program/add
  app.post('/api/programs/:program/add', async (req, reply) => {
    const user = requireUser(db, req, reply);
    if (!user) return;
    const { program } = req.params as { program: string };
    if (!defaultSources(db).some((s) => s.program === program)) {
      return reply.code(404).send({ error: 'program_not_found' });
    }
    const result = addProgramForUser(db, user.id, program);
    return { ok: true, added: result.added };
  });
}
