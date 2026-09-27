import { randomBytes } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { MAX_VIEWS_PER_USER, viewInputSchema, viewPatchSchema } from '@planner/shared';
import type { Db } from '../db/index.ts';
import { createView, deleteView, getView, listViews, reorderViews, setViewShareToken, updateView } from '../db/repo.ts';
import { requireUser } from '../auth/session.ts';

export function registerViewRoutes(app: FastifyInstance, db: Db): void {
  // GET /api/views
  // Note: a brand-new account can legitimately have zero views for a
  // moment - the client decides whether to seed a default one or offer to
  // import guest-mode views instead, since only the client knows whether
  // there's local guest data waiting to be imported (see PlannerContext).
  app.get('/api/views', async (req, reply) => {
    const user = requireUser(db, req, reply);
    if (!user) return;
    return { views: listViews(db, user.id) };
  });

  // POST /api/views
  app.post('/api/views', async (req, reply) => {
    const user = requireUser(db, req, reply);
    if (!user) return;
    if (listViews(db, user.id).length >= MAX_VIEWS_PER_USER) {
      return reply.code(400).send({ error: 'too_many_views' });
    }
    const parsed = viewInputSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'invalid_body', issues: parsed.error.issues });
    const view = createView(db, user.id, parsed.data.name, parsed.data.settings);
    return { view };
  });

  // PUT /api/views/:id
  app.put('/api/views/:id', async (req, reply) => {
    const user = requireUser(db, req, reply);
    if (!user) return;
    const id = Number((req.params as { id: string }).id);
    if (!Number.isInteger(id)) return reply.code(400).send({ error: 'invalid_id' });
    const parsed = viewPatchSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'invalid_body', issues: parsed.error.issues });
    const view = updateView(db, user.id, id, parsed.data);
    if (!view) return reply.code(404).send({ error: 'not_found' });
    return { view };
  });

  // PUT /api/views/order
  app.put('/api/views/order', async (req, reply) => {
    const user = requireUser(db, req, reply);
    if (!user) return;
    const body = req.body as { order?: unknown };
    if (
      !Array.isArray(body.order) ||
      body.order.length > MAX_VIEWS_PER_USER ||
      !body.order.every((x) => Number.isInteger(x))
    ) {
      return reply.code(400).send({ error: 'invalid_body' });
    }
    reorderViews(db, user.id, body.order as number[]);
    return { views: listViews(db, user.id) };
  });

  // DELETE /api/views/:id
  app.delete('/api/views/:id', async (req, reply) => {
    const user = requireUser(db, req, reply);
    if (!user) return;
    const id = Number((req.params as { id: string }).id);
    if (!Number.isInteger(id)) return reply.code(400).send({ error: 'invalid_id' });
    if (!getView(db, user.id, id)) return reply.code(404).send({ error: 'not_found' });
    deleteView(db, user.id, id);
    return { ok: true };
  });

  // POST /api/views/:id/share
  app.post('/api/views/:id/share', async (req, reply) => {
    const user = requireUser(db, req, reply);
    if (!user) return;
    const id = Number((req.params as { id: string }).id);
    if (!Number.isInteger(id)) return reply.code(400).send({ error: 'invalid_id' });
    // 144 bits of randomness, url-safe: issuing a new token also silently
    // invalidates whatever link was shared before.
    const token = randomBytes(18).toString('base64url');
    const view = setViewShareToken(db, user.id, id, token);
    if (!view) return reply.code(404).send({ error: 'not_found' });
    return { view };
  });

  // DELETE /api/views/:id/share
  app.delete('/api/views/:id/share', async (req, reply) => {
    const user = requireUser(db, req, reply);
    if (!user) return;
    const id = Number((req.params as { id: string }).id);
    if (!Number.isInteger(id)) return reply.code(400).send({ error: 'invalid_id' });
    const view = setViewShareToken(db, user.id, id, null);
    if (!view) return reply.code(404).send({ error: 'not_found' });
    return { view };
  });
}
