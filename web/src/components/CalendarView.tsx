import dayGridPlugin from '@fullcalendar/daygrid';
import interactionPlugin from '@fullcalendar/interaction';
import listPlugin from '@fullcalendar/list';
import FullCalendar from '@fullcalendar/react';
import type { EventContentArg, EventInput } from '@fullcalendar/core';
import timeGridPlugin from '@fullcalendar/timegrid';
import { useQuery } from '@tanstack/react-query';
import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type {
  CalendarEventDto,
  CalendarMode,
  CustomEventDto,
  CustomEventOccurrence,
  EventLabelDto,
  ViewSettings,
} from '@planner/shared';
import { expandOccurrences } from '@planner/shared';
import { api } from '../api/client.ts';
import { colorForCourse, readableTextColor, resolveCustomEventColor } from '../lib/color.ts';
import { CINECA_QUERY_RETRY, cinecaRetryDelay } from '../lib/retry.ts';
import { useIsMobile } from '../hooks/useMediaQuery.ts';
import { EventMarkerIcons, eventMarkers } from './EventMarkers.tsx';

export interface CalendarViewHandle {
  prev(): void;
  next(): void;
  today(): void;
}

// What the calendar needs of an event; shared-link events (no notes or link) fit too
export type CalendarCustomEvent = Pick<CustomEventDto, 'id' | 'labelId' | 'title' | 'location' | 'color' | 'timeZone' | 'schedule'> &
  Partial<Pick<CustomEventDto, 'notes' | 'url'>>;

export interface SlotSelection {
  start: Date;
  end: Date;
  allDay: boolean;
}

// Tells the two event sources apart inside FullCalendar's callbacks
type EventKindProps =
  | { kind: 'cineca'; dto: CalendarEventDto }
  | { kind: 'custom'; event: CalendarCustomEvent; occurrence: CustomEventOccurrence };

const DEFAULT_SLOT_MIN_MINUTES = 7 * 60;
const DEFAULT_SLOT_MAX_MINUTES = 21 * 60;

// FullCalendar duration string; 24:00:00 is a valid slotMaxTime
function slotTime(minutes: number): string {
  return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}:00`;
}

const MODE_TO_FC: Record<CalendarMode, string> = {
  week: 'timeGridWeek',
  day: 'timeGridDay',
  month: 'dayGridMonth',
  list: 'listWeek',
};

export const CalendarView = forwardRef<
  CalendarViewHandle,
  {
    settings: ViewSettings;
    mode: CalendarMode;
    onModeChange: (mode: CalendarMode) => void;
    onTitleChange: (title: string) => void;
    onEventClick: (event: CalendarEventDto) => void;
    customEvents: { events: CalendarCustomEvent[]; labels: EventLabelDto[] };
    onCustomEventClick: (event: CalendarCustomEvent, occurrence: CustomEventOccurrence) => void;
    // Without it the calendar is read-only (shared links)
    onSlotSelect?: (selection: SlotSelection) => void;
  }
>(function CalendarView(
  { settings, mode, onModeChange, onTitleChange, onEventClick, customEvents, onCustomEventClick, onSlotSelect },
  ref,
) {
  const { t, i18n } = useTranslation();
  const isMobile = useIsMobile();
  const calRef = useRef<FullCalendar>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [range, setRange] = useState<{ from: string; to: string } | null>(null);
  // Tracks whatever date FullCalendar is currently centered on, fed back in
  // as `initialDate` below. FC itself never resets this on its own across
  // option changes, but it's a cheap, robust safety net: if this component
  // were ever remounted for any reason, it restarts where the user left
  // off instead of snapping back to today.
  const [anchorDate, setAnchorDate] = useState<Date | undefined>(undefined);
  const mounted = useRef(false);
  // FC's own nowIndicator only exists in time grids and its list view only
  // re-renders once a day, so the list's now marker needs its own clock.
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    if (mode !== 'list') return;
    setNow(new Date());
    const id = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(id);
  }, [mode]);

  useImperativeHandle(ref, () => ({
    prev: () => calRef.current?.getApi().prev(),
    next: () => calRef.current?.getApi().next(),
    today: () => calRef.current?.getApi().today(),
  }));

  // FC computes its own column widths and caches them; it only recomputes
  // on a window `resize` event, not when a sibling (like the sidebar)
  // changes size via CSS. Watch our own wrapper directly so collapsing the
  // sidebar, dragging its resize handle, or any other layout change all
  // make the calendar re-measure and fill the space it actually has.
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const observer = new ResizeObserver(() => {
      calRef.current?.getApi().updateSize();
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // Switch view type on the existing calendar instance (no remount, no
  // `key` prop) so the currently visible date carries over - e.g. going
  // from week to month lands on the month that week belongs to, instead
  // of resetting to today.
  useEffect(() => {
    if (!mounted.current) {
      mounted.current = true;
      return;
    }
    calRef.current?.getApi().changeView(MODE_TO_FC[mode]);
  }, [mode]);

  // Tapping a date (day number in month view, day header in week view)
  // drills into Day view for that date - the readable fallback for the
  // grid views on a narrow phone screen.
  function goToDay(date: Date) {
    onModeChange('day');
    calRef.current?.getApi().changeView('timeGridDay', date);
  }

  // Same month layout as Cineca events; the dot takes the event's own color
  function customEventContent(arg: EventContentArg, event: CalendarCustomEvent) {
    if (arg.view.type === 'dayGridMonth') {
      if (isMobile) return <span className="event-dot" style={{ background: arg.event.borderColor }} />;
      return (
        <span className="event-line">
          <span className="event-dot" style={{ background: arg.event.borderColor }} />
          {arg.timeText && <span className="event-line-time">{arg.timeText}</span>}
          <span className="event-line-title">{arg.event.title}</span>
        </span>
      );
    }
    return (
      <div className="event-card">
        {arg.timeText && <div className="meta">{arg.timeText}</div>}
        <div className="title">{arg.event.title}</div>
        {event.location && <div className="meta">{event.location}</div>}
      </div>
    );
  }

  function eventContent(arg: EventContentArg) {
    const props = arg.event.extendedProps as EventKindProps;
    if (props.kind === 'custom') return customEventContent(arg, props.event);
    const ev = props.dto;
    const cancelled = ev.status === 'cancelled' ? ' cancelled' : '';

    if (arg.view.type === 'dayGridMonth') {
      // A custom eventContent replaces FC's whole default renderer, dot
      // included, so the color dot has to be drawn here explicitly on
      // every width - it's not just a mobile-only fallback.
      // A phone-width month column has no room for readable text at all;
      // show just the dot and let tapping the day drill into Day view.
      if (isMobile) {
        return <span className={`event-dot${cancelled}`} style={{ background: arg.event.borderColor }} />;
      }
      return (
        <span className={`event-line${cancelled}`}>
          <span className="event-dot" style={{ background: arg.event.borderColor }} />
          {arg.timeText && <span className="event-line-time">{arg.timeText}</span>}
          <EventMarkerIcons event={ev} />
          <span className="event-line-title">{arg.event.title}</span>
        </span>
      );
    }

    return (
      <div className={`event-card${cancelled}`}>
        {(arg.timeText || eventMarkers(ev).length > 0) && (
          <div className="meta">
            <EventMarkerIcons event={ev} />
            {arg.timeText}
          </div>
        )}
        <div className="title">{arg.event.title}</div>
        {ev.rooms[0] && <div className="meta">{ev.rooms[0].name}</div>}
      </div>
    );
  }

  // Tag today's list rows by start time; rows are already sorted by start,
  // so CSS can draw the now marker where started meets upcoming.
  function eventClassNames(arg: EventContentArg) {
    if (arg.view.type !== 'listWeek' || !arg.isToday) return [];
    const started = arg.event.start !== null && arg.event.start <= now;
    return [started ? 'list-today-started' : 'list-today-upcoming'];
  }

  // Cineca knows nothing of custom events: leaving them out of the key and the
  // body keeps label or sharing toggles from refetching the timetable
  const cinecaSettings = useMemo(() => {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { customEvents: _customEvents, ...rest } = settings;
    return rest;
  }, [settings]);

  const eventsQuery = useQuery({
    queryKey: ['events', cinecaSettings, range?.from, range?.to],
    queryFn: () => api.previewEvents(range!.from, range!.to, cinecaSettings),
    enabled: Boolean(range) && settings.sources.length > 0,
    retry: CINECA_QUERY_RETRY,
    retryDelay: cinecaRetryDelay,
  });

  const cinecaEvents: EventInput[] = useMemo(() => {
    return (eventsQuery.data?.events ?? []).map((ev) => {
      const color = colorForCourse(ev.courseKey, settings.colors);
      const title = i18n.language === 'en' && ev.courseNameEn ? ev.courseNameEn : ev.courseName;
      return {
        id: ev.id,
        title,
        start: ev.start,
        end: ev.end,
        backgroundColor: color,
        borderColor: color,
        textColor: '#ffffff',
        extendedProps: { kind: 'cineca', dto: ev } satisfies EventKindProps,
      } satisfies EventInput;
    });
  }, [eventsQuery.data, settings.colors, i18n.language]);

  const { events: customDefinitions, labels: customLabels } = customEvents;
  const showCustom = settings.customEvents.show;
  const hiddenLabels = settings.customEvents.hiddenLabels;

  // Unlabeled events have no switch of their own, so they follow the master toggle only
  const visibleDefinitions = useMemo(() => {
    if (!showCustom) return [];
    const hidden = new Set(hiddenLabels);
    return customDefinitions.filter((event) => event.labelId === null || !hidden.has(event.labelId));
  }, [customDefinitions, showCustom, hiddenLabels]);

  const occurrences = useMemo(
    () => (range ? expandOccurrences(visibleDefinitions, new Date(range.from), new Date(range.to)) : []),
    [visibleDefinitions, range],
  );

  const customInputs: EventInput[] = useMemo(() => {
    const byId = new Map(visibleDefinitions.map((event) => [event.id, event]));
    return occurrences.flatMap((occurrence) => {
      const event = byId.get(occurrence.eventId);
      if (!event) return [];
      const color = resolveCustomEventColor(event, customLabels);
      return [
        {
          id: `custom:${occurrence.key}`,
          title: event.title,
          start: occurrence.start,
          end: occurrence.end,
          allDay: occurrence.allDay,
          backgroundColor: color,
          borderColor: color,
          textColor: readableTextColor(color),
          extendedProps: { kind: 'custom', event, occurrence } satisfies EventKindProps,
        } satisfies EventInput,
      ];
    });
  }, [occurrences, visibleDefinitions, customLabels]);

  const events: EventInput[] = useMemo(() => [...cinecaEvents, ...customInputs], [cinecaEvents, customInputs]);

  // Time grids default to 07-21; widen them when a loaded event falls outside, or it would be invisible
  const slotBounds = useMemo(() => {
    let min = DEFAULT_SLOT_MIN_MINUTES;
    let max = DEFAULT_SLOT_MAX_MINUTES;
    for (const ev of events) {
      if (ev.allDay || typeof ev.start !== 'string' || typeof ev.end !== 'string') continue;
      const start = new Date(ev.start);
      const end = new Date(ev.end);
      const startMinutes = start.getHours() * 60 + start.getMinutes();
      const endMinutes = end.getHours() * 60 + end.getMinutes();
      const nextMidnight = new Date(start.getFullYear(), start.getMonth(), start.getDate() + 1).getTime();
      min = Math.min(min, startMinutes);
      if (end.getTime() <= nextMidnight) {
        max = Math.max(max, end.getTime() === nextMidnight ? 24 * 60 : endMinutes);
      } else {
        // Runs past midnight: the next day's part starts at 00:00
        min = 0;
        max = 24 * 60;
      }
    }
    return { min: slotTime(Math.floor(min / 60) * 60), max: slotTime(Math.ceil(max / 60) * 60) };
  }, [events]);

  // Judged on the unfiltered definitions: hiding every label still leaves a calendar to show
  if (settings.sources.length === 0 && customDefinitions.length === 0) {
    return <div className="empty-state">{t('empty.noSources')}</div>;
  }

  const errorCount = eventsQuery.data?.errors.length ?? 0;
  const isRetrying = eventsQuery.isFetching && eventsQuery.failureCount > 0;
  // No data at all yet: block the (empty) grid with a full overlay. Once
  // something is on screen, a retry (e.g. after a Cineca hiccup) or a
  // background refetch only needs a small corner badge so stale data stays
  // readable while fresh data loads.
  const showInitialLoading = eventsQuery.isLoading;
  const showBackgroundSync = eventsQuery.isFetching && !eventsQuery.isLoading;

  return (
    <>
      {eventsQuery.isError && (
        <div className="banner">
          {t('calendar.loadError')}
          <button className="text-btn" onClick={() => eventsQuery.refetch()}>
            {t('action.retry')}
          </button>
        </div>
      )}
      {!eventsQuery.isError && errorCount > 0 && <div className="banner">{t('sidebar.sourceError')} ({errorCount})</div>}
      <div ref={wrapRef} style={{ height: '100%', position: 'relative' }}>
        {showInitialLoading && (
          <div className="calendar-loading-overlay">
            <span className="spinner spinner-lg" />
            <p>{isRetrying ? t('calendar.retrying') : t('calendar.loadingEvents')}</p>
          </div>
        )}
        {showBackgroundSync && (
          <div className="calendar-loading-badge">
            <span className="spinner" />
            <span>{isRetrying ? t('calendar.retrying') : t('calendar.loadingEvents')}</span>
          </div>
        )}
        <FullCalendar
          ref={calRef}
          plugins={[dayGridPlugin, timeGridPlugin, listPlugin, interactionPlugin]}
          initialView={MODE_TO_FC[mode]}
          initialDate={anchorDate}
          headerToolbar={false}
          height="100%"
          firstDay={1}
          weekends={!settings.hideWeekends}
          locale={i18n.language}
          nowIndicator
          slotMinTime={slotBounds.min}
          slotMaxTime={slotBounds.max}
          dayMaxEvents
          navLinks
          navLinkDayClick={(date) => goToDay(date)}
          views={{ dayGridMonth: { eventDisplay: 'list-item' } }}
          events={events}
          eventContent={eventContent}
          eventClassNames={eventClassNames}
          eventClick={(arg) => {
            const props = arg.event.extendedProps as EventKindProps;
            if (props.kind === 'custom') onCustomEventClick(props.event, props.occurrence);
            else onEventClick(props.dto);
          }}
          selectable={Boolean(onSlotSelect)}
          selectMirror
          selectLongPressDelay={300}
          select={(arg) => {
            onSlotSelect?.({ start: arg.start, end: arg.end, allDay: arg.allDay });
            calRef.current?.getApi().unselect();
          }}
          datesSet={(arg) => {
            onTitleChange(arg.view.title);
            setRange({ from: arg.start.toISOString(), to: arg.end.toISOString() });
            const current = calRef.current?.getApi().getDate();
            if (current) setAnchorDate(current);
          }}
        />
      </div>
    </>
  );
});
