import { z } from 'zod';
import {
  hexColorSchema,
  MAX_CUSTOM_EVENTS_PER_USER,
  MAX_EVENT_LABELS_PER_USER,
  MAX_RANGE_DAYS,
  MAX_VIEWS_PER_USER,
  viewInputSchema,
} from './schemas.ts';
import { hasControlOrInvisibleChars } from './textSanitize.ts';

// User-created calendar events: validation, time zone math and occurrence
// expansion. Shared so the server, the web app and guest storage all apply
// exactly the same rules.

export const MAX_EVENT_TITLE_LENGTH = 120;
export const MAX_EVENT_LOCATION_LENGTH = 120;
export const MAX_EVENT_NOTES_LENGTH = 1000;
export const MAX_LABEL_NAME_LENGTH = 40;
export const MAX_EVENT_URL_LENGTH = 2048;
export const MAX_EVENT_SLOTS = 14;
export const MAX_EVENT_EXCEPTIONS = 100;
export const MAX_RECURRENCE_INTERVAL_WEEKS = 4;
export const MAX_ONE_SHOT_SPAN_DAYS = 14;
// Bounds the work (and FullCalendar's DOM) for a single visible range
export const MAX_OCCURRENCES_PER_EXPANSION = 2000;
export const MIN_EVENT_YEAR = 2000;
export const MAX_EVENT_YEAR = 2100;
const MAX_TIME_ZONE_LENGTH = 64;

const DAY_MS = 24 * 60 * 60 * 1000;
const MINUTE_MS = 60 * 1000;

// Dates and times

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const START_TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;
// 24:00 lets a slot end exactly at midnight
const END_TIME_RE = /^(?:([01]\d|2[0-3]):([0-5]\d)|(24):(00))$/;

/** Days since the Unix epoch for a strict YYYY-MM-DD calendar date, or null if malformed or out of range. */
export function dayNumberOf(date: string): number | null {
  const m = DATE_RE.exec(date);
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  if (year < MIN_EVENT_YEAR || year > MAX_EVENT_YEAR) return null;
  const ms = Date.UTC(year, month - 1, day);
  const check = new Date(ms);
  // Rejects rollovers such as 2026-02-30
  if (check.getUTCFullYear() !== year || check.getUTCMonth() !== month - 1 || check.getUTCDate() !== day) return null;
  return ms / DAY_MS;
}

export function dateOfDayNumber(dayNumber: number): string {
  return new Date(dayNumber * DAY_MS).toISOString().slice(0, 10);
}

/** ISO weekday, Monday = 1 ... Sunday = 7. */
export function isoWeekdayOfDayNumber(dayNumber: number): number {
  return ((new Date(dayNumber * DAY_MS).getUTCDay() + 6) % 7) + 1;
}

/** Minutes since midnight; accepts 24:00 only when allowEndOfDay is set. */
export function minutesOf(time: string, allowEndOfDay = false): number | null {
  const m = (allowEndOfDay ? END_TIME_RE : START_TIME_RE).exec(time);
  if (!m) return null;
  if (m[3] === '24') return 24 * 60;
  return Number(m[1]) * 60 + Number(m[2]);
}

// Time zones

const TIME_ZONE_RE = /^[A-Za-z][A-Za-z0-9_+-]*(\/[A-Za-z0-9_+-]+){0,2}$/;
const zoneFormatters = new Map<string, Intl.DateTimeFormat>();

function zoneFormatter(timeZone: string): Intl.DateTimeFormat {
  let formatter = zoneFormatters.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    zoneFormatters.set(timeZone, formatter);
  }
  return formatter;
}

/**
 * Canonical IANA zone name, or null if unknown: shape check first, then the
 * runtime's own zone database. Canonicalizing (Intl accepts any letter case)
 * keeps the formatter cache bounded by the number of real zones.
 */
export function canonicalTimeZone(timeZone: string): string | null {
  if (timeZone.length > MAX_TIME_ZONE_LENGTH || !TIME_ZONE_RE.test(timeZone)) return null;
  try {
    return new Intl.DateTimeFormat('en-US', { timeZone }).resolvedOptions().timeZone;
  } catch {
    return null;
  }
}

/** Offset (local minus UTC, in ms) of a zone at a given instant. */
function zoneOffsetMs(timeZone: string, utcMs: number): number {
  const parts = zoneFormatter(timeZone).formatToParts(new Date(utcMs));
  const part = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((p) => p.type === type)?.value);
  // Some engines still print midnight as 24 despite h23
  const hour = part('hour') % 24;
  const asUtc = Date.UTC(part('year'), part('month') - 1, part('day'), hour, part('minute'), part('second'));
  return asUtc - Math.floor(utcMs / 1000) * 1000;
}

/**
 * Converts a wall-clock date and time in a zone to a UTC instant.
 * A time skipped by a spring-forward gap moves forward by the gap length;
 * a time repeated by a fall-back overlap resolves to its earlier instance.
 * Assumes valid inputs (callers validate through the schemas first).
 */
export function localToUtc(date: string, time: string, timeZone: string): number {
  const day = dayNumberOf(date);
  const minutes = minutesOf(time, true);
  if (day === null || minutes === null) throw new Error('invalid date or time');
  const naive = day * DAY_MS + minutes * MINUTE_MS;
  const offsetBefore = zoneOffsetMs(timeZone, naive - DAY_MS);
  const offsetAfter = zoneOffsetMs(timeZone, naive + DAY_MS);
  if (offsetBefore === offsetAfter) return naive - offsetBefore;
  // A transition is near: keep each candidate that maps back to the same wall time
  const candidates = [naive - offsetBefore, naive - offsetAfter].filter(
    (utc) => utc + zoneOffsetMs(timeZone, utc) === naive,
  );
  if (candidates.length > 0) return Math.min(...candidates);
  // Inside a gap: the pre-transition offset lands after the gap
  return naive - offsetBefore;
}

// Schemas

function cleanSingleLine(s: string): string {
  return s.normalize('NFC').trim();
}

/** Required single-line text: NFC, trimmed, length-capped, no control or invisible characters. */
function singleLineTextSchema(max: number) {
  return z
    .string()
    // Cheap guard before normalizing; NFC never grows text anywhere near 4x
    .max(max * 4, 'too_long')
    .transform(cleanSingleLine)
    .pipe(
      z
        .string()
        .min(1, 'required')
        .max(max, 'too_long')
        .refine((s) => !hasControlOrInvisibleChars(s), 'invalid_chars'),
    );
}

/** Optional single-line text; missing or blank becomes null. */
function optionalSingleLineTextSchema(max: number) {
  return z
    .string()
    .max(max * 4, 'too_long')
    .nullish()
    .transform((s) => {
      const cleaned = s == null ? '' : cleanSingleLine(s);
      return cleaned === '' ? null : cleaned;
    })
    .pipe(
      z
        .string()
        .max(max, 'too_long')
        .refine((s) => !hasControlOrInvisibleChars(s), 'invalid_chars')
        .nullable(),
    );
}

/** Optional multi-line notes: like single-line text, but LF line breaks are kept. */
const notesSchema = z
  .string()
  .max(MAX_EVENT_NOTES_LENGTH * 4, 'too_long')
  .nullish()
  .transform((s) => {
    const cleaned = s == null ? '' : s.replace(/\r\n?/g, '\n').normalize('NFC').trim();
    return cleaned === '' ? null : cleaned;
  })
  .pipe(
    z
      .string()
      .max(MAX_EVENT_NOTES_LENGTH, 'too_long')
      .refine((s) => !hasControlOrInvisibleChars(s, { allowNewline: true }), 'invalid_chars')
      .nullable(),
  );

/**
 * Canonical https URL, or null when the input is not a plain https link.
 * Rejects other schemes (javascript:, data:, http:), embedded credentials,
 * whitespace and control or invisible characters.
 */
export function parseHttpsUrl(input: string): string | null {
  if (input.length > MAX_EVENT_URL_LENGTH) return null;
  if (/\s/.test(input) || hasControlOrInvisibleChars(input)) return null;
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' || url.username !== '' || url.password !== '' || url.hostname === '') return null;
  return url.href.length > MAX_EVENT_URL_LENGTH ? null : url.href;
}

const eventUrlSchema = z
  .string()
  .max(MAX_EVENT_URL_LENGTH * 2, 'too_long')
  .nullish()
  .transform((s, ctx) => {
    const trimmed = s?.trim() ?? '';
    if (trimmed === '') return null;
    const href = parseHttpsUrl(trimmed);
    if (href === null) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'invalid_url' });
      return z.NEVER;
    }
    return href;
  });

export const eventDateSchema = z
  .string()
  .max(10, 'invalid_date')
  .refine((s) => dayNumberOf(s) !== null, 'invalid_date');
const startTimeSchema = z.string().regex(START_TIME_RE, 'invalid_time');
const endTimeSchema = z.string().regex(END_TIME_RE, 'invalid_time');

export const timeZoneSchema = z
  .string()
  .max(MAX_TIME_ZONE_LENGTH, 'invalid_time_zone')
  .transform((s, ctx) => {
    const canonical = canonicalTimeZone(s);
    if (canonical === null) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'invalid_time_zone' });
      return z.NEVER;
    }
    return canonical;
  });

const entityIdSchema = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);

const onceScheduleSchema = z
  .object({
    kind: z.literal('once'),
    startDate: eventDateSchema,
    startTime: startTimeSchema,
    endDate: eventDateSchema,
    endTime: endTimeSchema,
  })
  .strict();

const allDayScheduleSchema = z
  .object({
    kind: z.literal('allDay'),
    startDate: eventDateSchema,
    // Inclusive
    endDate: eventDateSchema,
  })
  .strict();

const weeklySlotSchema = z
  .object({
    weekday: z.number().int().min(1).max(7),
    startTime: startTimeSchema,
    endTime: endTimeSchema,
  })
  .strict();

const weeklyScheduleSchema = z
  .object({
    kind: z.literal('weekly'),
    startDate: eventDateSchema,
    untilDate: eventDateSchema.nullable().default(null),
    intervalWeeks: z.number().int().min(1).max(MAX_RECURRENCE_INTERVAL_WEEKS).default(1),
    slots: z.array(weeklySlotSchema).min(1, 'required').max(MAX_EVENT_SLOTS, 'too_many'),
    // Skipped occurrences, by local date
    exceptions: z
      .array(eventDateSchema)
      .max(MAX_EVENT_EXCEPTIONS, 'too_many')
      .default([])
      .transform((dates) => [...new Set(dates)].sort()),
  })
  .strict();

function issue(ctx: z.RefinementCtx, path: (string | number)[], message: string): void {
  ctx.addIssue({ code: z.ZodIssueCode.custom, path, message });
}

export const eventScheduleSchema = z
  .discriminatedUnion('kind', [onceScheduleSchema, allDayScheduleSchema, weeklyScheduleSchema])
  .superRefine((schedule, ctx) => {
    // zod still runs this when a field check failed, so every parse is re-guarded;
    // the failing field has already reported its own issue
    const startDay = dayNumberOf(schedule.startDate);
    if (startDay === null) return;
    if (schedule.kind === 'once') {
      const endDay = dayNumberOf(schedule.endDate);
      const startMinutes = minutesOf(schedule.startTime);
      const endMinutes = minutesOf(schedule.endTime, true);
      if (endDay === null || startMinutes === null || endMinutes === null) return;
      const start = startDay * 24 * 60 + startMinutes;
      const end = endDay * 24 * 60 + endMinutes;
      if (end <= start) issue(ctx, ['endTime'], 'end_before_start');
      else if (end - start > MAX_ONE_SHOT_SPAN_DAYS * 24 * 60) issue(ctx, ['endDate'], 'span_too_long');
    } else if (schedule.kind === 'allDay') {
      const endDay = dayNumberOf(schedule.endDate);
      if (endDay === null) return;
      if (endDay < startDay) issue(ctx, ['endDate'], 'end_before_start');
      else if (endDay - startDay + 1 > MAX_ONE_SHOT_SPAN_DAYS) issue(ctx, ['endDate'], 'span_too_long');
    } else {
      const untilDay = schedule.untilDate === null ? null : dayNumberOf(schedule.untilDate);
      if (schedule.untilDate !== null && untilDay === null) return;
      if (untilDay !== null && untilDay < startDay) issue(ctx, ['untilDate'], 'until_before_start');
      const seen = new Set<string>();
      schedule.slots.forEach((slot, i) => {
        const startMinutes = minutesOf(slot.startTime);
        const endMinutes = minutesOf(slot.endTime, true);
        if (startMinutes !== null && endMinutes !== null && endMinutes <= startMinutes) {
          issue(ctx, ['slots', i, 'endTime'], 'end_before_start');
        }
        const key = `${slot.weekday}@${slot.startTime}`;
        if (seen.has(key)) issue(ctx, ['slots', i], 'duplicate_slot');
        seen.add(key);
      });
      schedule.exceptions.forEach((date, i) => {
        const day = dayNumberOf(date);
        if (day !== null && (day < startDay || (untilDay !== null && day > untilDay))) {
          issue(ctx, ['exceptions', i], 'exception_out_of_range');
        }
      });
    }
  });

export const customEventInputSchema = z
  .object({
    title: singleLineTextSchema(MAX_EVENT_TITLE_LENGTH),
    notes: notesSchema,
    location: optionalSingleLineTextSchema(MAX_EVENT_LOCATION_LENGTH),
    url: eventUrlSchema,
    labelId: entityIdSchema.nullable().default(null),
    // Overrides the label color; null falls back to it
    color: hexColorSchema.nullable().default(null),
    timeZone: timeZoneSchema,
    schedule: eventScheduleSchema,
  })
  .strict();

// What the server stores per event; the label reference lives in its own column
export const customEventDataSchema = customEventInputSchema.omit({ labelId: true });

export const eventLabelInputSchema = z
  .object({
    name: singleLineTextSchema(MAX_LABEL_NAME_LENGTH),
    color: hexColorSchema,
  })
  .strict();

/**
 * One-shot move of guest data into a fresh account. Labels carry a local ref;
 * events' labelId and views' hiddenLabels point at those refs, and the server
 * remaps them to the ids it assigns, all in a single transaction.
 */
export const guestImportSchema = z
  .object({
    labels: z
      .array(eventLabelInputSchema.extend({ ref: entityIdSchema }))
      .max(MAX_EVENT_LABELS_PER_USER, 'too_many')
      .refine((labels) => new Set(labels.map((l) => l.ref)).size === labels.length, 'duplicate_ref'),
    events: z.array(customEventInputSchema).max(MAX_CUSTOM_EVENTS_PER_USER, 'too_many'),
    views: z.array(viewInputSchema).max(MAX_VIEWS_PER_USER, 'too_many'),
  })
  .strict();

export type GuestImportInput = z.input<typeof guestImportSchema>;
export type GuestImportData = z.output<typeof guestImportSchema>;

export type EventSchedule = z.output<typeof eventScheduleSchema>;
export type WeeklySlot = z.output<typeof weeklySlotSchema>;
export type CustomEventInput = z.input<typeof customEventInputSchema>;
export type CustomEventData = z.output<typeof customEventInputSchema>;
export type EventLabelInput = z.input<typeof eventLabelInputSchema>;

export type CustomEventDto = CustomEventData & {
  id: number;
  updatedAt: string;
};

export interface EventLabelDto {
  id: number;
  name: string;
  color: string;
}

export interface CustomEventsResponse {
  events: CustomEventDto[];
  labels: EventLabelDto[];
}

// Public share-link payload: no notes, no link, event ids renumbered
export interface SharedCustomEventDto {
  id: number;
  labelId: number | null;
  title: string;
  location: string | null;
  color: string | null;
  timeZone: string;
  schedule: EventSchedule;
}

export interface SharedCustomEventsDto {
  events: SharedCustomEventDto[];
  labels: EventLabelDto[];
}

// Expansion

export interface CustomEventOccurrence {
  eventId: number;
  // Stable per occurrence, unique within one expansion
  key: string;
  // ISO instants for timed occurrences; YYYY-MM-DD with an exclusive end when allDay
  start: string;
  end: string;
  allDay: boolean;
  // Local date in the event's zone; what a weekly exception refers to
  date: string;
}

export type ExpandableEvent = Pick<CustomEventDto, 'id' | 'timeZone' | 'schedule'>;

/**
 * Turns event definitions into concrete occurrences overlapping [from, to).
 * Work is bounded by the range (clamped to MAX_RANGE_DAYS) rather than by
 * how long ago a series started, and output stops at
 * MAX_OCCURRENCES_PER_EXPANSION. An event that fails to expand (e.g. a zone
 * this runtime does not know) is skipped without affecting the others.
 */
export function expandOccurrences(events: readonly ExpandableEvent[], from: Date, to: Date): CustomEventOccurrence[] {
  const fromMs = from.getTime();
  const toMs = Math.min(to.getTime(), fromMs + MAX_RANGE_DAYS * DAY_MS);
  if (!Number.isFinite(fromMs) || !Number.isFinite(toMs) || toMs <= fromMs) return [];
  // Day-level bounds, padded for zone offsets (up to +-14h) and 24:00 ends
  const firstDay = Math.floor(fromMs / DAY_MS) - 2;
  const lastDay = Math.floor(toMs / DAY_MS) + 1;
  const out: CustomEventOccurrence[] = [];

  const pushTimed = (event: ExpandableEvent, key: string, date: string, startMs: number, endMs: number) => {
    if (endMs <= startMs || startMs >= toMs || endMs <= fromMs) return;
    out.push({
      eventId: event.id,
      key,
      start: new Date(startMs).toISOString(),
      end: new Date(endMs).toISOString(),
      allDay: false,
      date,
    });
  };

  for (const event of events) {
    if (out.length >= MAX_OCCURRENCES_PER_EXPANSION) break;
    try {
      const { schedule, timeZone } = event;
      if (schedule.kind === 'once') {
        pushTimed(
          event,
          `${event.id}:once`,
          schedule.startDate,
          localToUtc(schedule.startDate, schedule.startTime, timeZone),
          localToUtc(schedule.endDate, schedule.endTime, timeZone),
        );
      } else if (schedule.kind === 'allDay') {
        const startDay = dayNumberOf(schedule.startDate);
        const endDay = dayNumberOf(schedule.endDate);
        if (startDay === null || endDay === null || startDay > lastDay || endDay < firstDay) continue;
        out.push({
          eventId: event.id,
          key: `${event.id}:allDay`,
          start: schedule.startDate,
          end: dateOfDayNumber(endDay + 1),
          allDay: true,
          date: schedule.startDate,
        });
      } else {
        expandWeekly(event, schedule, firstDay, lastDay, pushTimed, () => out.length >= MAX_OCCURRENCES_PER_EXPANSION);
      }
    } catch {
      // Skip this event only
    }
  }
  return out.slice(0, MAX_OCCURRENCES_PER_EXPANSION);
}

function expandWeekly(
  event: ExpandableEvent,
  schedule: Extract<EventSchedule, { kind: 'weekly' }>,
  firstDay: number,
  lastDay: number,
  pushTimed: (event: ExpandableEvent, key: string, date: string, startMs: number, endMs: number) => void,
  full: () => boolean,
): void {
  const startDay = dayNumberOf(schedule.startDate);
  if (startDay === null) return;
  const untilDay = schedule.untilDate === null ? Infinity : dayNumberOf(schedule.untilDate);
  if (untilDay === null) return;
  const anchorMonday = startDay - (isoWeekdayOfDayNumber(startDay) - 1);
  const skipped = new Set(schedule.exceptions);
  const slotsByWeekday = new Map<number, { slot: WeeklySlot; index: number }[]>();
  schedule.slots.forEach((slot, index) => {
    const list = slotsByWeekday.get(slot.weekday) ?? [];
    list.push({ slot, index });
    slotsByWeekday.set(slot.weekday, list);
  });

  const from = Math.max(firstDay, startDay);
  const to = Math.min(lastDay, untilDay);
  for (let day = from; day <= to; day += 1) {
    if (Math.floor((day - anchorMonday) / 7) % schedule.intervalWeeks !== 0) continue;
    const slots = slotsByWeekday.get(isoWeekdayOfDayNumber(day));
    if (!slots) continue;
    const date = dateOfDayNumber(day);
    if (skipped.has(date)) continue;
    for (const { slot, index } of slots) {
      if (full()) return;
      pushTimed(
        event,
        `${event.id}:${date}:${index}`,
        date,
        localToUtc(date, slot.startTime, event.timeZone),
        localToUtc(date, slot.endTime, event.timeZone),
      );
    }
  }
}
