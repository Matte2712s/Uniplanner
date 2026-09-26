import { canonicalCalendarUrl, parseSourceUrl, type SourceUrlError } from '@planner/shared';
import type { Db } from '../db/index.ts';
import { findSource, insertSource, type SourceRow } from '../db/repo.ts';
import { fetchCalendarInfo, getClienteId, SourceUnavailableError } from '../cineca/service.ts';

export type ValidationError =
  | { kind: 'url'; reason: SourceUrlError }
  | { kind: 'unreachable'; message: string };

export type ValidationResult =
  | { ok: true; host: string; linkCalendarioId: string; title: string; titleEn: string | null; canonicalUrl: string }
  | { ok: false; error: ValidationError };

/**
 * Validates a user-supplied Cineca calendar URL end to end: syntax and host
 * allowlist, then a live lookup against the canonical, rebuilt API URL
 * (never the URL the user typed) to confirm the calendar really exists.
 */
export async function validateSourceUrl(db: Db, input: unknown): Promise<ValidationResult> {
  const parsed = parseSourceUrl(input);
  if (!parsed.ok) return { ok: false, error: { kind: 'url', reason: parsed.error } };

  const { host, linkCalendarioId } = parsed.value;
  try {
    const clienteId = await getClienteId(db, host);
    const info = await fetchCalendarInfo(host, linkCalendarioId, clienteId);
    return {
      ok: true,
      host,
      linkCalendarioId,
      title: info.title,
      titleEn: info.titleEn,
      canonicalUrl: canonicalCalendarUrl(host, linkCalendarioId),
    };
  } catch (err) {
    const message = err instanceof SourceUnavailableError ? err.message : 'Could not verify this calendar';
    return { ok: false, error: { kind: 'unreachable', message } };
  }
}

export function persistValidatedSource(
  db: Db,
  validated: Extract<ValidationResult, { ok: true }>,
  createdBy: number | null,
): SourceRow {
  const existing = findSource(db, validated.host, validated.linkCalendarioId);
  if (existing) return existing;
  return insertSource(db, {
    kind: 'custom',
    host: validated.host,
    link_calendario_id: validated.linkCalendarioId,
    title: validated.title,
    title_en: validated.titleEn,
    created_by: createdBy,
  });
}
