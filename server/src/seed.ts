import { readFileSync } from 'node:fs';
import { isCinecaHost, LINK_ID_RE } from '@planner/shared';
import type { Db } from './db/index.ts';
import { encodeGroupPath, upsertDefaultSource } from './db/repo.ts';
import { fetchCalendarInfo, getClienteId } from './cineca/service.ts';
import { env } from './env.ts';

interface SourceLeaf {
  host: string;
  linkCalendarioId: string;
  // Optional display name overrides; when absent, the title is fetched live from Cineca
  title?: string;
  titleEn?: string;
}

interface FolderNode {
  // Folder label shown in the source picker; nests as deep as needed
  folder: string;
  children: ConfigNode[];
}

type ConfigNode = SourceLeaf | FolderNode;

function isFolderNode(node: ConfigNode): node is FolderNode {
  return typeof (node as FolderNode).folder === 'string' && Array.isArray((node as FolderNode).children);
}

interface ProgramEntry {
  // Supported degree program this source belongs to (e.g. "Informatica") - what a user opts into
  program?: string;
  children: ConfigNode[];
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
  let programs: ProgramEntry[];
  try {
    programs = JSON.parse(readFileSync(env.sourcesConfigPath, 'utf8'));
  } catch (err) {
    log.warn({ err }, 'no default sources config found, skipping seed');
    return;
  }

  for (const entry of programs) {
    const program = clip(entry.program, 200) ?? null;
    await seedNodes(db, log, entry.children ?? [], program, []);
  }
}

async function seedNodes(db: Db, log: Logger, nodes: ConfigNode[], program: string | null, path: string[]): Promise<void> {
  for (const node of nodes) {
    if (isFolderNode(node)) {
      await seedNodes(db, log, node.children, program, [...path, node.folder]);
    } else {
      await seedLeaf(db, log, node, program, path);
    }
  }
}

async function seedLeaf(db: Db, log: Logger, entry: SourceLeaf, program: string | null, path: string[]): Promise<void> {
  const host = String(entry.host || '').toLowerCase();
  const linkId = String(entry.linkCalendarioId || '').toLowerCase();
  if (!isCinecaHost(host) || !LINK_ID_RE.test(linkId)) {
    log.warn({ entry }, 'skipping invalid default source config entry');
    return;
  }
  const groupPath = encodeGroupPath(path);
  try {
    const clienteId = await getClienteId(db, host);
    const info = await fetchCalendarInfo(host, linkId, clienteId);
    const title = clip(entry.title, 300) ?? info.title;
    const titleEn = clip(entry.titleEn, 300) ?? info.titleEn;
    upsertDefaultSource(db, { host, link_calendario_id: linkId, title, title_en: titleEn, group_path: groupPath, program });
    log.info({ host, linkId, title, path, program }, 'seeded default source');
  } catch (err) {
    log.warn({ err, host, linkId }, 'could not seed default source, will retry next boot');
  }
}
