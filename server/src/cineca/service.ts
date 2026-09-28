import type { CalendarEventDto } from '@planner/shared';
import type { Db } from '../db/index.ts';
import { getHostClienteId, getCachedWeek, saveCachedWeek, saveHostClienteId } from '../db/repo.ts';
import { fetchCinecaJson, CinecaFetchError } from './client.ts';
import { clienteSchema, impegniResponseSchema, linkCalendarioSchema } from './rawSchema.ts';
import { normalizeEvent } from './normalize.ts';

const HOST_TTL_MS = 24 * 60 * 60 * 1000;
const WEEK_TTL_MS = 30 * 60 * 1000;
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

export class SourceUnavailableError extends Error {}

export async function getClienteId(db: Db, host: string): Promise<string> {
  const cached = getHostClienteId(db, host, HOST_TTL_MS);
  if (cached) return cached;
  let raw: unknown;
  try {
    raw = await fetchCinecaJson(host, '/api/Clienti/cercaPerDominio', { method: 'GET', query: { dominio: host } });
  } catch (err) {
    throw new SourceUnavailableError(`Cannot reach ${host}: ${(err as Error).message}`);
  }
  const parsed = clienteSchema.safeParse(raw);
  if (!parsed.success) throw new SourceUnavailableError(`Unexpected client response from ${host}`);
  saveHostClienteId(db, host, parsed.data.id);
  return parsed.data.id;
}

export interface CalendarInfo {
  title: string;
  titleEn: string | null;
}

export async function fetchCalendarInfo(host: string, linkCalendarioId: string, clienteId: string): Promise<CalendarInfo> {
  let raw: unknown;
  try {
    raw = await fetchCinecaJson(host, '/api/LinkCalendario/searchCalendarioPubblico', {
      method: 'POST',
      body: { linkCalendarioId, filter: { clienteId } },
    });
  } catch (err) {
    throw new SourceUnavailableError(`Cannot reach calendar on ${host}: ${(err as Error).message}`);
  }
  const parsed = linkCalendarioSchema.safeParse(raw);
  if (!parsed.success) throw new SourceUnavailableError(`Calendar not found on ${host}`);

  const { payload } = parsed.data;
  if (payload.titolo) return { title: payload.titolo, titleEn: payload.titolo_EN ?? null };

  // Personal "libretto studente" link: synthesize a title from course/track/year.
  if (payload.cdaCorso) {
    const track = [payload.cdaCorso, payload.cdaPercorso].filter(Boolean).join('/');
    const year = payload.annoCorso;
    return {
      title: `Libretto studente - ${track}${year ? ` - Anno ${year}` : ''}`,
      titleEn: `Student timetable - ${track}${year ? ` - Year ${year}` : ''}`,
    };
  }

  throw new SourceUnavailableError(`Calendar not found on ${host}`);
}

function mondayUtc(date: Date): Date {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const day = d.getUTCDay(); // 0 = Sunday
  const diff = day === 0 ? -6 : 1 - day;
  d.setUTCDate(d.getUTCDate() + diff);
  return d;
}

async function fetchWeek(
  host: string,
  linkCalendarioId: string,
  clienteId: string,
  weekStart: Date,
): Promise<unknown[]> {
  const weekEnd = new Date(weekStart.getTime() + WEEK_MS);
  let raw: unknown;
  try {
    raw = await fetchCinecaJson(host, '/api/Impegni/getImpegniCalendarioPubblico', {
      method: 'POST',
      body: {
        linkCalendarioId,
        clienteId,
        dataInizio: weekStart.toISOString(),
        dataFine: weekEnd.toISOString(),
        mostraImpegniAnnullati: true,
        mostraIndisponibilitaTotali: false,
        pianificazioneTemplate: false,
      },
    });
  } catch (err) {
    throw new SourceUnavailableError(`Cannot load events from ${host}: ${(err as Error).message}`);
  }
  const parsed = impegniResponseSchema.safeParse(raw);
  if (!parsed.success) throw new SourceUnavailableError(`Unexpected events response from ${host}`);
  return parsed.data as unknown[];
}

export interface EventSource {
  id: number;
  host: string;
  linkCalendarioId: string;
}

/** Loads events for one source across [from, to), cached in whole weeks. */
export async function getEventsForSource(db: Db, source: EventSource, from: Date, to: Date): Promise<CalendarEventDto[]> {
  const clienteId = await getClienteId(db, source.host);
  const events: CalendarEventDto[] = [];
  const seen = new Set<string>();

  let cursor = mondayUtc(from);
  while (cursor < to) {
    const weekKey = cursor.toISOString();
    let raw = getCachedWeek(db, source.id, weekKey, WEEK_TTL_MS);
    if (!raw) {
      raw = await fetchWeek(source.host, source.linkCalendarioId, clienteId, cursor);
      saveCachedWeek(db, source.id, weekKey, raw);
    }
    for (const item of raw) {
      const parsed = impegniResponseSchema.element.safeParse(item);
      if (!parsed.success) continue;
      const ev = normalizeEvent(source.id, parsed.data);
      if (seen.has(ev.id)) continue;
      seen.add(ev.id);
      if (new Date(ev.start) < to && new Date(ev.end) > from) events.push(ev);
    }
    cursor = new Date(cursor.getTime() + WEEK_MS);
  }

  events.sort((a, b) => a.start.localeCompare(b.start));
  return events;
}

export { CinecaFetchError };
