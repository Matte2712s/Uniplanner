import type { CalendarEventDto, CourseDto } from '@planner/shared';
import { courseKeyOf } from '@planner/shared';
import { STATUS_MAP, type RawImpegno } from './rawSchema.ts';

// Strips control characters that could confuse terminals/UIs even though
// nothing here is ever rendered as HTML; defense in depth for plain text.
function clean(value: string | null | undefined): string | null {
  if (!value) return null;
  // eslint-disable-next-line no-control-regex
  const stripped = value.replace(/[\u0000-\u001f\u007f]/g, '').trim();
  return stripped || null;
}

function fullName(p: { nome?: string | null; cognome?: string | null }): string | null {
  return clean([p.cognome, p.nome].filter(Boolean).join(' ')) || clean(p.nome ?? null);
}

function firstPartition(imp: RawImpegno): string | null {
  for (const d of imp.evento?.dettagliDidattici ?? []) {
    const label = clean(d.partizione?.descrizione ?? null);
    if (label) return label;
  }
  return null;
}

export function normalizeEvent(sourceId: number, imp: RawImpegno): CalendarEventDto {
  const code = clean(imp.codiceAttivita) ?? 'N/D';
  const name = clean(imp.nome) ?? code;
  return {
    id: `${sourceId}:${imp.eventoId}:${imp.dataInizio}`,
    sourceId,
    courseKey: courseKeyOf(code, name),
    courseCode: code,
    courseName: name,
    courseNameEn: clean(imp.nome_EN),
    activity: clean(imp.tipoAttivita?.descrizione ?? null),
    partition: firstPartition(imp),
    start: imp.dataInizio,
    end: imp.dataFine,
    teachers: (imp.docenti ?? []).map(fullName).filter((x): x is string => Boolean(x)),
    rooms: (imp.aule ?? []).map((a) => ({
      name: clean(a.descrizione) ?? '?',
      building: clean(a.edificio?.descrizione ?? null),
    })),
    status: STATUS_MAP[imp.stato] ?? 'ok',
    online: Boolean(imp.evento?.online),
    onlineUrl: safeHttpsUrl(imp.linkTeledidattica),
    notes: clean(imp.notePubbliche),
    notesEn: clean(imp.notePubbliche_EN),
  };
}

function safeHttpsUrl(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' ? url.toString() : null;
  } catch {
    return null;
  }
}

export function coursesFromEvents(sourceId: number, events: CalendarEventDto[]): CourseDto[] {
  const map = new Map<string, CourseDto>();
  for (const e of events) {
    if (e.sourceId !== sourceId) continue;
    if (!map.has(e.courseKey)) {
      map.set(e.courseKey, {
        key: e.courseKey,
        code: e.courseCode,
        name: e.courseName,
        nameEn: e.courseNameEn,
        partition: e.partition,
      });
    }
  }
  return [...map.values()].sort((a, b) => a.name.localeCompare(b.name));
}
