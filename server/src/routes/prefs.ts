import type { FastifyInstance } from 'fastify';
import { prefsSchema } from '@planner/shared';
import type { Db } from '../db/index.ts';
import { getPrefs, getView, setPrefs } from '../db/repo.ts';
import { requireUser } from '../auth/session.ts';

export function registerPrefsRoutes(app: FastifyInstance, db: Db): void {
  // GET /api/prefs
  app.get('/api/prefs', async (req, reply) => {
    const user = requireUser(db, req, reply);
    if (!user) return;
    return getPrefs(db, user.id);
  });

  // PUT /api/prefs
  app.put('/api/prefs', async (req, reply) => {
    const user = requireUser(db, req, reply);
    if (!user) return;
    const parsed = prefsSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'invalid_body', issues: parsed.error.issues });
    if (parsed.data.activeViewId != null && !getView(db, user.id, parsed.data.activeViewId)) {
      return reply.code(400).send({ error: 'invalid_view' });
    }
    setPrefs(db, user.id, parsed.data);
    return getPrefs(db, user.id);
  });
}
