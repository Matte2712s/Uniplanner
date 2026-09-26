import { readFileSync } from 'node:fs';
import { isCinecaHost, LINK_ID_RE } from '@planner/shared';
import type { Db } from './db/index.ts';
import { upsertDefaultSource } from './db/repo.ts';
import { fetchCalendarInfo, getClienteId } from './cineca/service.ts';
import { env } from './env.ts';

interface ConfigEntry {
  host: string;
  linkCalendarioId: string;
  // Supported degree program this source belongs to (e.g. "Informatica") - what a user opts into
  program?: string;
  // Optional folder label to group this source under in the picker (e.g. "Primo anno")
  group?: string;
  // Optional display name overrides; when absent, the title is fetched live from Cineca
  title?: string;
  titleEn?: string;
}

interface Logger {
  info(obj: unknown, msg?: string): void;
  warn(obj: unknown, msg?: string): void;
}

function clip(value: string | undefined, max: number): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed.slice(0, max) : undefined;
}

export async function seedDefaultSources(db: Db, log: Logger): Promise<void> {
  let entries: ConfigEntry[];
  try {
    entries = JSON.parse(readFileSync(env.sourcesConfigPath, 'utf8'));
  } catch (err) {
    log.warn({ err }, 'no default sources config found, skipping seed');
    return;
  }

  for (const entry of entries) {
    const host = String(entry.host || '').toLowerCase();
    const linkId = String(entry.linkCalendarioId || '').toLowerCase();
    if (!isCinecaHost(host) || !LINK_ID_RE.test(linkId)) {
      log.warn({ entry }, 'skipping invalid default source config entry');
      continue;
    }
    const group = clip(entry.group, 200) ?? null;
    const program = clip(entry.program, 200) ?? null;
    try {
      const clienteId = await getClienteId(db, host);
      const info = await fetchCalendarInfo(host, linkId, clienteId);
      const title = clip(entry.title, 300) ?? info.title;
      const titleEn = clip(entry.titleEn, 300) ?? info.titleEn;
      upsertDefaultSource(db, { host, link_calendario_id: linkId, title, title_en: titleEn, group_path: group, program });
      log.info({ host, linkId, title, group, program }, 'seeded default source');
    } catch (err) {
      log.warn({ err, host, linkId }, 'could not seed default source, will retry next boot');
    }
  }
}
