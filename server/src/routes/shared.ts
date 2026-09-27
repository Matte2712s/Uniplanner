import type { FastifyInstance } from 'fastify';
import type { SharedViewDto } from '@planner/shared';
import type { Db } from '../db/index.ts';
import { getViewByShareToken } from '../db/repo.ts';

export function registerSharedViewRoutes(app: FastifyInstance, db: Db): void {
  // GET /api/shared/:token
  app.get('/api/shared/:token', async (req, reply) => {
    const { token } = req.params as { token: string };
    const view = getViewByShareToken(db, token);
    if (!view) return reply.code(404).send({ error: 'not_found' });
    return { name: view.name, settings: view.settings } satisfies SharedViewDto;
  });
}
