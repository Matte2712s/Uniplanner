import type { FastifyInstance } from 'fastify';
import type { SharedCustomEventDto, SharedCustomEventsDto, SharedViewDto } from '@planner/shared';
import type { Db } from '../db/index.ts';
import { getSharedViewContext, getViewByShareToken, listCustomEvents, listEventLabels } from '../db/repo.ts';

export function registerSharedViewRoutes(app: FastifyInstance, db: Db): void {
  // GET /api/shared/:token
  app.get('/api/shared/:token', async (req, reply) => {
    const { token } = req.params as { token: string };
    const view = getViewByShareToken(db, token);
    if (!view) return reply.code(404).send({ error: 'not_found' });
    // Hidden labels are applied server-side by the custom-events endpoint; real label ids stay private
    const customEvents = { ...view.settings.customEvents, hiddenLabels: [] };
    return { name: view.name, settings: { ...view.settings, customEvents } } satisfies SharedViewDto;
  });

  // GET /api/shared/:token/custom-events
  app.get(
    '/api/shared/:token/custom-events',
    { config: { rateLimit: { max: 60, timeWindow: '1 minute' } } },
    async (req, reply) => {
      const { token } = req.params as { token: string };
      const shared = getSharedViewContext(db, token);
      if (!shared) return reply.code(404).send({ error: 'not_found' });
      const { show, shareInLink, hiddenLabels } = shared.settings.customEvents;
      if (!show || !shareInLink) return { events: [], labels: [] } satisfies SharedCustomEventsDto;

      const hidden = new Set(hiddenLabels);
      const visible = listCustomEvents(db, shared.userId).filter((e) => e.labelId === null || !hidden.has(e.labelId));
      // Labels are renumbered 1..n in id order, like events, so real ids never leave the server
      const used = new Set(visible.flatMap((e) => (e.labelId === null ? [] : [e.labelId])));
      const usedLabels = listEventLabels(db, shared.userId).filter((l) => used.has(l.id));
      const sharedLabelId = new Map(usedLabels.map((l, i) => [l.id, i + 1]));
      const labels = usedLabels.map((l) => ({ id: sharedLabelId.get(l.id)!, name: l.name, color: l.color }));
      // Explicit allowlist of fields; notes, link and the real event id never leave the server
      const events: SharedCustomEventDto[] = visible.map((e, i) => ({
        id: i + 1,
        labelId: e.labelId === null ? null : (sharedLabelId.get(e.labelId) ?? null),
        title: e.title,
        location: e.location,
        color: e.color,
        timeZone: e.timeZone,
        schedule: e.schedule,
      }));
      return { events, labels } satisfies SharedCustomEventsDto;
    },
  );
}
