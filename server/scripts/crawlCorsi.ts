// Crawls Campusnet insegnamento listings and builds a sources.json program entry.
// Usage: npm run crawl -- <listing-url...> [--program "Name"] [--out file.json]
import { writeFileSync } from 'node:fs';
import { parseSourceUrl } from '@planner/shared';

const MAX_PAGES = 500;
const CONCURRENCY = 4;
const YEAR_LABELS = ['Primo', 'Secondo', 'Terzo', 'Quarto', 'Quinto', 'Sesto'];
const NO_YEAR = 'Anno non indicato';

interface Insegnamento {
  id: string;
  name: string;
  nameEn: string;
  code: string;
  url: string;
  degree: string;
  year: number | null;
  yearText: string;
  link: { host: string; linkCalendarioId: string } | null;
}

interface SourceNode {
  host: string;
  linkCalendarioId: string;
  title?: string;
  titleEn?: string;
}

const args = process.argv.slice(2);
const urls: string[] = [];
let programArg: string | undefined;
let outFile: string | undefined;
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--program') programArg = args[++i];
  else if (args[i] === '--out') outFile = args[++i];
  else urls.push(args[i] ?? '');
}
if (urls.length === 0) {
  console.error('Usage: npm run crawl -- <listing-url...> [--program "Name"] [--out file.json]');
  process.exit(1);
}

const decode = (s: string): string =>
  s
    .replace(/<[^>]*>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/\s+/g, ' ')
    .trim();

function assertUnitoUrl(raw: string): URL {
  const u = new URL(raw);
  if (u.protocol !== 'https:' || !(u.hostname === 'unito.it' || u.hostname.endsWith('.unito.it'))) {
    throw new Error(`Only https *.unito.it pages are allowed: ${raw}`);
  }
  return u;
}

async function fetchHtml(raw: string): Promise<string> {
  assertUnitoUrl(raw);
  let lastErr: unknown;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(raw, { headers: { 'user-agent': 'unito-planner-crawler' }, redirect: 'follow' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.text();
    } catch (err) {
      lastErr = err;
      await new Promise((r) => setTimeout(r, 500 * (attempt + 1)));
    }
  }
  throw new Error(`Failed to fetch ${raw}: ${(lastErr as Error).message}`);
}

// Walk the pager until there is no next link
async function collectListing(start: string): Promise<Map<string, { name: string; code: string; url: string }>> {
  const found = new Map<string, { name: string; code: string; url: string }>();
  const visited = new Set<string>();
  let next: string | null = start;
  while (next && visited.size < MAX_PAGES && !visited.has(next)) {
    visited.add(next);
    const html = await fetchHtml(next);
    const before = found.size;
    const itemRe = /<a href="([^"]*corsi\.pl\/Show\?_id=([a-z0-9]+))"[^>]*>\s*<strong>([\s\S]*?)<\/strong>\s*<\/a>\s*(?:\(([^)]*)\))?/gi;
    for (const m of html.matchAll(itemRe)) {
      const id = m[2] ?? '';
      if (!id || found.has(id)) continue;
      found.set(id, {
        name: decode(m[3] ?? ''),
        code: decode(m[4] ?? ''),
        url: new URL(decode(m[1] ?? ''), next).toString(),
      });
    }
    console.error(`page ${visited.size}: ${found.size - before} new (${found.size} total)`);
    const nextMatch = html.match(/<a[^>]*class="[^"]*nextPage[^"]*"[^>]*href="([^"]+)"|<a[^>]*href="([^"]+)"[^>]*class="[^"]*nextPage[^"]*"/i);
    const nextHref = nextMatch ? (nextMatch[1] ?? nextMatch[2]) : null;
    next = nextHref && found.size > before ? new URL(decode(nextHref), next).toString() : null;
  }
  return found;
}

function labelValue(html: string, label: string): string {
  const re = new RegExp(`<dt[^>]*>\\s*<span>\\s*${label}\\s*</span>\\s*</dt>\\s*<dd[^>]*>([\\s\\S]*?)</dd>`, 'i');
  const m = html.match(re);
  return m ? decode(m[1] ?? '') : '';
}

// Insegnamento page heading: plain H2 is Italian, H2.italic is English
function pageTitle(html: string, english: boolean): string {
  const re = new RegExp(`<dd[^>]*>\\s*<h2${english ? '\\s+class="italic"' : ''}>([\\s\\S]*?)</h2>`, 'i');
  const m = html.match(re);
  return m ? decode(m[1] ?? '') : '';
}

function parseYear(text: string): number | null {
  const m = text.match(/(\d+)\s*[°o]?\s*anno/i) ?? text.match(/^\s*(\d+)\b/);
  return m ? Number(m[1]) : null;
}

function findCalendarLink(html: string): Insegnamento['link'] {
  const hrefs = [...html.matchAll(/href="([^"]*calendarioPubblico[^"]*)"/gi)].map((m) => decode(m[1] ?? ''));
  for (const href of hrefs) {
    const parsed = parseSourceUrl(href);
    if (parsed.ok) return parsed.value;
  }
  return null;
}

async function loadInsegnamento(id: string, base: { name: string; code: string; url: string }): Promise<Insegnamento> {
  const html = await fetchHtml(base.url);
  const yearText = labelValue(html, 'Anno');
  return {
    id,
    ...base,
    // Listing name is the fallback when the page heading is missing
    name: pageTitle(html, false) || base.name,
    nameEn: pageTitle(html, true),
    degree: labelValue(html, 'Corso di studio'),
    year: parseYear(yearText),
    yearText,
    link: findCalendarLink(html),
  };
}

async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let cursor = 0;
  const worker = async (): Promise<void> => {
    while (cursor < items.length) {
      const i = cursor++;
      results[i] = await fn(items[i] as T);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

const yearFolder = (year: number | null, yearText: string): string => {
  if (year === null) return yearText && /uni/i.test(yearText) ? 'Anno unico' : NO_YEAR;
  return YEAR_LABELS[year - 1] ? `${YEAR_LABELS[year - 1]} anno` : `${year}° anno`;
};

const listing = new Map<string, { name: string; code: string; url: string }>();
for (const url of urls) {
  for (const [id, item] of await collectListing(url)) listing.set(id, item);
}
console.error(`${listing.size} insegnamenti found, loading details`);

let done = 0;
const all = await mapLimit([...listing], CONCURRENCY, async ([id, base]) => {
  try {
    const ins = await loadInsegnamento(id, base);
    console.error(`[${++done}/${listing.size}] ${ins.name}: ${ins.link ? ins.link.linkCalendarioId : 'no calendar'}`);
    return ins;
  } catch (err) {
    console.error(`[${++done}/${listing.size}] ${base.name}: ${(err as Error).message}`);
    return null;
  }
});
const insegnamenti = all.filter((i): i is Insegnamento => i !== null);

// One source per calendar: several insegnamenti often share one
interface Group {
  link: { host: string; linkCalendarioId: string };
  items: Insegnamento[];
}
const byDegree = new Map<string, Map<string, Group>>();
const noCalendar: Insegnamento[] = [];
for (const ins of insegnamenti) {
  if (!ins.link) {
    noCalendar.push(ins);
    continue;
  }
  const degree = programArg ?? (ins.degree || 'Senza corso di studio');
  const groups = byDegree.get(degree) ?? new Map<string, Group>();
  const group = groups.get(ins.link.linkCalendarioId) ?? { link: ins.link, items: [] };
  group.items.push(ins);
  groups.set(ins.link.linkCalendarioId, group);
  byDegree.set(degree, groups);
}

const output = [...byDegree].map(([program, groups]) => {
  const byYear = new Map<string, { order: number; sources: SourceNode[] }>();
  for (const group of groups.values()) {
    const years = group.items.map((i) => i.year).filter((y): y is number => y !== null);
    const year = years.length ? Math.min(...years) : null;
    const first = group.items[0] as Insegnamento;
    const folder = yearFolder(year, first.yearText);
    const node: SourceNode = { host: group.link.host, linkCalendarioId: group.link.linkCalendarioId };
    // Shared calendars get all names joined, rename by hand if needed
    node.title = group.items.map((i) => i.name).join(' / ').slice(0, 300);
    // English only when every insegnamento in the group has one
    if (group.items.every((i) => i.nameEn)) node.titleEn = group.items.map((i) => i.nameEn).join(' / ').slice(0, 300);
    if (group.items.length > 1) console.error(`shared calendar ${node.linkCalendarioId} (${folder}): ${group.items.map((i) => i.name).join(' | ')}`);
    const entry = byYear.get(folder) ?? { order: year ?? 99, sources: [] };
    entry.sources.push(node);
    byYear.set(folder, entry);
  }
  const children = [...byYear]
    .sort((a, b) => a[1].order - b[1].order)
    .map(([folder, { sources }]) => ({
      folder,
      children: sources.sort((a, b) => (a.title ?? '').localeCompare(b.title ?? '', 'it')),
    }));
  return { program, children };
});

if (noCalendar.length) {
  console.error(`\n${noCalendar.length} insegnamenti without an Orario lezioni link:`);
  for (const ins of noCalendar) console.error(`  ${ins.name} (${ins.code}) ${ins.url}`);
}

const json = JSON.stringify(output, null, 2);
if (outFile) {
  writeFileSync(outFile, json + '\n');
  console.error(`written to ${outFile}`);
} else {
  console.log(json);
}
