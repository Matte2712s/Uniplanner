import {
  MAX_HIDDEN_RULES_PER_SOURCE,
  type CalendarEventDto,
  type HiddenRule,
  type ViewSettings,
} from './schemas.ts';

// Hiding lessons from a view: slot extraction and rule matching and editing.
// Shared so the web app, guest storage and tests apply exactly the same rules.

// Cineca timetables are always Italian time, whatever zone the browser is in
export const SOURCE_TIME_ZONE = 'Europe/Rome';

const ISO_WEEKDAYS: Record<string, number> = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 };

const slotFormatter = new Intl.DateTimeFormat('en-US', {
  timeZone: SOURCE_TIME_ZONE,
  hourCycle: 'h23',
  weekday: 'short',
  hour: '2-digit',
  minute: '2-digit',
});

/** ISO weekday (Monday = 1) and 'HH:MM' start time of an instant, in Europe/Rome. */
export function weeklySlotOf(start: string): { weekday: number; time: string } {
  const parts = slotFormatter.formatToParts(new Date(start));
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === type)?.value ?? '';
  // Some engines still print midnight as 24 despite h23
  const hour = Number(part('hour')) % 24;
  return {
    weekday: ISO_WEEKDAYS[part('weekday')] ?? 1,
    time: `${String(hour).padStart(2, '0')}:${part('minute').padStart(2, '0')}`,
  };
}

/** Every rule that hides this event. */
export function matchingHiddenRules(rules: readonly HiddenRule[], event: CalendarEventDto): HiddenRule[] {
  if (rules.length === 0) return [];
  const partition = event.partition ?? null;
  let slot: ReturnType<typeof weeklySlotOf> | undefined;
  return rules.filter((rule) => {
    if (rule.kind === 'once') return rule.eventId === event.id;
    if (rule.courseKey !== event.courseKey || rule.partition !== partition) return false;
    slot ??= weeklySlotOf(event.start);
    return rule.weekday === slot.weekday && rule.time === slot.time;
  });
}

export function isEventHidden(rules: readonly HiddenRule[], event: CalendarEventDto): boolean {
  return matchingHiddenRules(rules, event).length > 0;
}

function ruleFor(event: CalendarEventDto, kind: 'once' | 'weekly'): HiddenRule {
  if (kind === 'once') return { kind, eventId: event.id, courseKey: event.courseKey, start: event.start };
  return { kind, courseKey: event.courseKey, partition: event.partition ?? null, ...weeklySlotOf(event.start) };
}

function sameRule(a: HiddenRule, b: HiddenRule): boolean {
  if (a.kind === 'once' || b.kind === 'once') return a.kind === 'once' && b.kind === 'once' && a.eventId === b.eventId;
  return a.courseKey === b.courseKey && a.partition === b.partition && a.weekday === b.weekday && a.time === b.time;
}

function withHidden(settings: ViewSettings, sourceId: number, hidden: HiddenRule[]): ViewSettings {
  return { ...settings, sources: settings.sources.map((s) => (s.sourceId === sourceId ? { ...s, hidden } : s)) };
}

/**
 * Adds a rule for the event to its source. A source at the cap first drops
 * 'once' rules for lessons already past; still full, it answers 'limit'.
 * Unchanged settings when the source is not in the view or the rule exists.
 */
export function hideEvent(
  settings: ViewSettings,
  event: CalendarEventDto,
  kind: 'once' | 'weekly',
  now = Date.now(),
): ViewSettings | 'limit' {
  const source = settings.sources.find((s) => s.sourceId === event.sourceId);
  if (!source) return settings;
  const rule = ruleFor(event, kind);
  if (source.hidden.some((existing) => sameRule(existing, rule))) return settings;

  let hidden = source.hidden;
  if (hidden.length >= MAX_HIDDEN_RULES_PER_SOURCE) {
    hidden = hidden.filter((r) => r.kind !== 'once' || Date.parse(r.start) >= now);
    if (hidden.length >= MAX_HIDDEN_RULES_PER_SOURCE) return 'limit';
  }
  return withHidden(settings, source.sourceId, [...hidden, rule]);
}

/** Removes every rule hiding the event, of either kind, so the lesson really shows again. */
export function unhideEvent(settings: ViewSettings, event: CalendarEventDto): ViewSettings {
  const source = settings.sources.find((s) => s.sourceId === event.sourceId);
  if (!source) return settings;
  const matching = new Set(matchingHiddenRules(source.hidden, event));
  if (matching.size === 0) return settings;
  return withHidden(
    settings,
    source.sourceId,
    source.hidden.filter((r) => !matching.has(r)),
  );
}
