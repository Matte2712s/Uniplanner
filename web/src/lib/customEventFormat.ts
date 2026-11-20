import type { TFunction } from 'i18next';
import type { CustomEventOccurrence, EventSchedule } from '@planner/shared';
import { canonicalTimeZone, dateOfDayNumber, dayNumberOf } from '@planner/shared';

const DAY_MS = 24 * 60 * 60 * 1000;

/** The browser's IANA zone in canonical form; UTC when it is unknown or unusable. */
export function browserTimeZone(): string {
  try {
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    return (zone && canonicalTimeZone(zone)) || 'UTC';
  } catch {
    return 'UTC';
  }
}

const pad = (n: number) => String(n).padStart(2, '0');

/** YYYY-MM-DD in the browser's zone. */
export function localDateString(d: Date): string {
  return `${String(d.getFullYear()).padStart(4, '0')}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** HH:MM in the browser's zone. */
export function localTimeString(d: Date): string {
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** Minutes since midnight as HH:MM; 1440 gives 24:00. */
export function timeFromMinutes(minutes: number): string {
  return `${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}`;
}

/** Calendar-date arithmetic on YYYY-MM-DD strings, free of zone and DST effects. */
export function addDays(date: string, days: number): string {
  const day = dayNumberOf(date);
  return day === null ? date : dateOfDayNumber(day + days);
}

// Weekdays

export interface WeekdayNames {
  // Monday first
  short: string[];
  long: string[];
}

const weekdayCache = new Map<string, WeekdayNames>();

export function weekdayNames(locale: string): WeekdayNames {
  const cached = weekdayCache.get(locale);
  if (cached) return cached;
  const names = (style: 'short' | 'long') => {
    const formatter = new Intl.DateTimeFormat(locale, { weekday: style, timeZone: 'UTC' });
    // 2024-01-01 is a Monday
    return Array.from({ length: 7 }, (_, i) => formatter.format(new Date(Date.UTC(2024, 0, 1 + i))));
  };
  const result = { short: names('short'), long: names('long') };
  weekdayCache.set(locale, result);
  return result;
}

// Dates

const dateFormatters = new Map<string, Intl.DateTimeFormat>();

function dateFormatter(locale: string, style: 'short' | 'long'): Intl.DateTimeFormat {
  const key = `${locale}|${style}`;
  let formatter = dateFormatters.get(key);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat(
      locale,
      style === 'long'
        ? { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }
        : { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' },
    );
    dateFormatters.set(key, formatter);
  }
  return formatter;
}

/** Formats a YYYY-MM-DD calendar date; UTC on purpose so the day never shifts. */
export function formatDate(date: string, locale: string, style: 'short' | 'long' = 'short'): string {
  const day = dayNumberOf(date);
  return day === null ? date : dateFormatter(locale, style).format(new Date(day * DAY_MS));
}

function formatTime(d: Date, locale: string): string {
  return new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit' }).format(d);
}

/** One concrete occurrence, in the browser's zone; an all-day end is exclusive. */
export function formatOccurrence(occurrence: CustomEventOccurrence, locale: string): string {
  if (occurrence.allDay) {
    const last = addDays(occurrence.end, -1);
    return last === occurrence.start
      ? formatDate(occurrence.start, locale, 'long')
      : `${formatDate(occurrence.start, locale)} - ${formatDate(last, locale)}`;
  }
  const start = new Date(occurrence.start);
  const end = new Date(occurrence.end);
  // An end at exactly midnight still belongs to the day it closes
  const sameDay = localDateString(start) === localDateString(new Date(end.getTime() - 1));
  if (sameDay) {
    return `${formatDate(localDateString(start), locale, 'long')}, ${formatTime(start, locale)} - ${formatTime(end, locale)}`;
  }
  return `${formatDate(localDateString(start), locale)}, ${formatTime(start, locale)} - ${formatDate(localDateString(end), locale)}, ${formatTime(end, locale)}`;
}

/** Human summary of a schedule; times are the event's own wall-clock times. */
export function describeSchedule(schedule: EventSchedule, t: TFunction, locale: string): string {
  if (schedule.kind === 'once') {
    const start = `${formatDate(schedule.startDate, locale)}, ${schedule.startTime}`;
    return schedule.startDate === schedule.endDate
      ? `${start} - ${schedule.endTime}`
      : `${start} - ${formatDate(schedule.endDate, locale)}, ${schedule.endTime}`;
  }
  if (schedule.kind === 'allDay') {
    return schedule.startDate === schedule.endDate
      ? formatDate(schedule.startDate, locale)
      : `${formatDate(schedule.startDate, locale)} - ${formatDate(schedule.endDate, locale)}`;
  }
  const names = weekdayNames(locale);
  const slots = [...schedule.slots]
    .sort((a, b) => a.weekday - b.weekday || a.startTime.localeCompare(b.startTime))
    .map((slot) => `${names.short[slot.weekday - 1] ?? ''} ${slot.startTime}-${slot.endTime}`)
    .join(', ');
  const base =
    schedule.intervalWeeks === 1
      ? t('customEvents.schedule.weekly', { slots })
      : t('customEvents.schedule.weeklyInterval', { weeks: schedule.intervalWeeks, slots });
  return schedule.untilDate === null
    ? base
    : `${base}, ${t('customEvents.schedule.until', { date: formatDate(schedule.untilDate, locale) })}`;
}
