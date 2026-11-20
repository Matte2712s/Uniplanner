import type { TFunction } from 'i18next';
import type { CustomEventData, CustomEventInput } from '@planner/shared';
import {
  customEventInputSchema,
  dayNumberOf,
  isoWeekdayOfDayNumber,
  MAX_EVENT_SLOTS,
  MAX_ONE_SHOT_SPAN_DAYS,
  minutesOf,
} from '@planner/shared';
import { isHexColor } from './color.ts';
import { browserTimeZone, localDateString, localTimeString, timeFromMinutes } from './customEventFormat.ts';

// Prefill for a new event: a calendar selection or a copy of an existing one
export type CustomEventDraft = Partial<CustomEventInput>;

export type ScheduleKind = 'once' | 'allDay' | 'weekly';

export interface SlotState {
  weekday: number;
  startTime: string;
  endTime: string;
}

// Plain strings, as typed into the inputs; validation happens on the built input
export interface EventFormState {
  title: string;
  notes: string;
  location: string;
  url: string;
  labelId: number | null;
  color: string | null;
  timeZone: string;
  kind: ScheduleKind;
  // Shared by every kind, so switching type keeps the date
  startDate: string;
  startTime: string;
  // End date also serves all-day (inclusive); end time is once-only
  endDate: string;
  endTime: string;
  // Empty means the series never ends
  untilDate: string;
  intervalWeeks: number;
  slots: SlotState[];
  exceptions: string[];
}

const DEFAULT_START_TIME = '09:00';
const DEFAULT_END_TIME = '10:00';

/** Next full hour to one hour later, in the browser's zone. */
function defaultTimes(now: Date): Pick<EventFormState, 'startDate' | 'startTime' | 'endDate' | 'endTime'> {
  const start = new Date(now);
  start.setMinutes(0, 0, 0);
  start.setHours(start.getHours() + 1);
  const end = new Date(start.getTime() + 60 * 60 * 1000);
  return {
    startDate: localDateString(start),
    startTime: localTimeString(start),
    endDate: localDateString(end),
    endTime: localTimeString(end),
  };
}

export function initialFormState(
  source: CustomEventDraft | undefined,
  labels: readonly { id: number }[],
  now: Date = new Date(),
): EventFormState {
  const base: EventFormState = {
    title: source?.title ?? '',
    notes: source?.notes ?? '',
    location: source?.location ?? '',
    url: source?.url ?? '',
    // A draft may point at a label that no longer exists
    labelId: source?.labelId != null && labels.some((l) => l.id === source.labelId) ? source.labelId : null,
    color: isHexColor(source?.color) ? source.color : null,
    timeZone: source?.timeZone ?? browserTimeZone(),
    kind: 'once',
    ...defaultTimes(now),
    untilDate: '',
    intervalWeeks: 1,
    slots: [],
    exceptions: [],
  };
  const schedule = source?.schedule;
  if (!schedule) return base;
  if (schedule.kind === 'once') {
    return { ...base, kind: 'once', startDate: schedule.startDate, startTime: schedule.startTime, endDate: schedule.endDate, endTime: schedule.endTime };
  }
  if (schedule.kind === 'allDay') {
    return { ...base, kind: 'allDay', startDate: schedule.startDate, endDate: schedule.endDate };
  }
  const first = schedule.slots[0];
  return {
    ...base,
    kind: 'weekly',
    startDate: schedule.startDate,
    endDate: schedule.startDate,
    startTime: first?.startTime ?? base.startTime,
    endTime: first?.endTime ?? base.endTime,
    untilDate: schedule.untilDate ?? '',
    intervalWeeks: schedule.intervalWeeks ?? 1,
    slots: schedule.slots.map((slot) => ({ ...slot })),
    exceptions: [...(schedule.exceptions ?? [])],
  };
}

// Editing helpers

function weekdayOf(date: string): number {
  const day = dayNumberOf(date);
  return day === null ? 1 : isoWeekdayOfDayNumber(day);
}

/** One weekly slot on the start date's weekday, reusing the current times when they make sense. */
function slotFromState(s: EventFormState): SlotState {
  const start = minutesOf(s.startTime);
  const end = minutesOf(s.endTime, true);
  const weekday = weekdayOf(s.startDate);
  if (start === null) return { weekday, startTime: DEFAULT_START_TIME, endTime: DEFAULT_END_TIME };
  if (end !== null && end > start && s.endDate === s.startDate) return { weekday, startTime: s.startTime, endTime: s.endTime };
  // Native time inputs cannot show 24:00, so a late default stops at 23:59
  return { weekday, startTime: s.startTime, endTime: timeFromMinutes(Math.min(start + 60, 24 * 60 - 1)) };
}

export function switchKind(s: EventFormState, kind: ScheduleKind): EventFormState {
  if (kind === s.kind) return s;
  const next: EventFormState = { ...s, kind };
  if (kind === 'weekly') {
    next.slots = [slotFromState(s)];
    return next;
  }
  // Weekly ignores the end date, so it may have gone stale
  const start = dayNumberOf(s.startDate);
  const end = dayNumberOf(s.endDate);
  if (end === null || (start !== null && end < start)) next.endDate = s.startDate;
  return next;
}

/** Moves the end date along when the event was a single day or would now end before it starts. */
export function setStartDate(s: EventFormState, startDate: string): EventFormState {
  const next = { ...s, startDate };
  const newStart = dayNumberOf(startDate);
  if (newStart === null || s.kind === 'weekly') return next;
  const end = dayNumberOf(s.endDate);
  if (s.endDate === s.startDate || (end !== null && end < newStart)) next.endDate = startDate;
  return next;
}

export function addSlot(s: EventFormState): EventFormState {
  if (s.slots.length >= MAX_EVENT_SLOTS) return s;
  const last = s.slots[s.slots.length - 1];
  const slot = last
    ? { weekday: (last.weekday % 7) + 1, startTime: last.startTime, endTime: last.endTime }
    : slotFromState(s);
  return { ...s, slots: [...s.slots, slot] };
}

/** Skipped dates that still fall inside the series; the ones outside are dropped before saving. */
export function effectiveExceptions(s: Pick<EventFormState, 'startDate' | 'untilDate' | 'exceptions'>): string[] {
  const start = dayNumberOf(s.startDate);
  const until = s.untilDate === '' ? null : dayNumberOf(s.untilDate);
  // A half-typed date must not wipe the list
  if (start === null || (s.untilDate !== '' && until === null)) return s.exceptions;
  return s.exceptions.filter((date) => {
    const day = dayNumberOf(date);
    return day !== null && day >= start && (until === null || day <= until);
  });
}

// Validation

export function buildInput(s: EventFormState): CustomEventInput {
  let schedule: CustomEventInput['schedule'];
  if (s.kind === 'once') {
    schedule = { kind: 'once', startDate: s.startDate, startTime: s.startTime, endDate: s.endDate, endTime: s.endTime };
  } else if (s.kind === 'allDay') {
    schedule = { kind: 'allDay', startDate: s.startDate, endDate: s.endDate };
  } else {
    schedule = {
      kind: 'weekly',
      startDate: s.startDate,
      untilDate: s.untilDate === '' ? null : s.untilDate,
      intervalWeeks: s.intervalWeeks,
      slots: s.slots.map((slot) => ({ weekday: slot.weekday, startTime: slot.startTime, endTime: slot.endTime })),
      exceptions: effectiveExceptions(s),
    };
  }
  return {
    title: s.title,
    notes: s.notes,
    location: s.location,
    url: s.url,
    labelId: s.labelId,
    color: s.color,
    timeZone: s.timeZone,
    schedule,
  };
}

/** Maps a zod issue path to the form field that shows it. */
export function fieldKeyOf(path: readonly (string | number)[]): string {
  const [root, second, third, fourth] = path;
  if (root !== 'schedule') return String(root ?? 'form');
  if (second === 'slots') {
    if (third === undefined) return 'slots';
    // A duplicate-slot issue sits on the slot itself; the weekday is its first field
    return `slot.${third}.${fourth ?? 'weekday'}`;
  }
  if (second === 'exceptions') return 'exceptions';
  return String(second ?? 'schedule');
}

export interface FormValidation {
  data: CustomEventData | null;
  // Field key to issue code, first issue per field
  errors: ReadonlyMap<string, string>;
}

export function validateForm(s: EventFormState): FormValidation {
  const result = customEventInputSchema.safeParse(buildInput(s));
  if (result.success) return { data: result.data, errors: new Map() };
  const errors = new Map<string, string>();
  for (const issue of result.error.issues) {
    const key = fieldKeyOf(issue.path);
    if (!errors.has(key)) errors.set(key, issue.message);
  }
  return { data: null, errors };
}

// Keys that have their own error text in the form; anything else gets a generic line
const PLACED_KEYS = new Set([
  'title',
  'notes',
  'location',
  'url',
  'labelId',
  'color',
  'timeZone',
  'startDate',
  'startTime',
  'endDate',
  'endTime',
  'untilDate',
  'slots',
  'exceptions',
]);

export function hasUnplacedError(errors: ReadonlyMap<string, string>): boolean {
  return [...errors.keys()].some((key) => !PLACED_KEYS.has(key) && !key.startsWith('slot.'));
}

// Messages

const ISSUE_CODES = new Set([
  'required',
  'too_long',
  'too_many',
  'invalid_chars',
  'invalid_url',
  'invalid_date',
  'invalid_time',
  'invalid_time_zone',
  'end_before_start',
  'span_too_long',
  'until_before_start',
  'duplicate_slot',
  'exception_out_of_range',
]);

/** Text for a schema issue code; anything unknown (e.g. a zod default message) is generic. */
export function issueMessage(t: TFunction, code: string): string {
  return ISSUE_CODES.has(code)
    ? t(`customEvents.error.${code}`, { max: MAX_ONE_SHOT_SPAN_DAYS })
    : t('customEvents.error.generic');
}

const REQUEST_ERROR_CODES = new Set(['too_many_custom_events', 'too_many_event_labels', 'invalid_label', 'too_many_exceptions']);

/** Text for a failed save: the server and guest store reject with a code as the message. */
export function requestErrorMessage(t: TFunction, error: unknown): string {
  const code = error instanceof Error ? error.message : '';
  return REQUEST_ERROR_CODES.has(code) ? t(`customEvents.error.${code}`) : t('customEvents.error.generic');
}
