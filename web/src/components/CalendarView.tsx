import dayGridPlugin from '@fullcalendar/daygrid';
import interactionPlugin from '@fullcalendar/interaction';
import listPlugin from '@fullcalendar/list';
import FullCalendar from '@fullcalendar/react';
import type { EventContentArg, EventInput } from '@fullcalendar/core';
import timeGridPlugin from '@fullcalendar/timegrid';
import { useQuery } from '@tanstack/react-query';
import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { CalendarEventDto, CalendarMode, ViewSettings } from '@planner/shared';
import { api } from '../api/client.ts';
import { colorForCourse } from '../lib/color.ts';
import { CINECA_QUERY_RETRY, cinecaRetryDelay } from '../lib/retry.ts';
import { useIsMobile } from '../hooks/useMediaQuery.ts';

export interface CalendarViewHandle {
  prev(): void;
  next(): void;
  today(): void;
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
  }
>(function CalendarView({ settings, mode, onModeChange, onTitleChange, onEventClick }, ref) {
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

  function eventContent(arg: EventContentArg) {
    const ev = arg.event.extendedProps.dto as CalendarEventDto;
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
          <span className="event-line-title">{arg.event.title}</span>
        </span>
      );
    }

    return (
      <div className={`event-card${cancelled}`}>
        {arg.timeText && <div className="meta">{arg.timeText}</div>}
        <div className="title">{arg.event.title}</div>
        {ev.rooms[0] && <div className="meta">{ev.rooms[0].name}</div>}
      </div>
    );
  }

  const eventsQuery = useQuery({
    queryKey: ['events', settings, range?.from, range?.to],
    queryFn: () => api.previewEvents(range!.from, range!.to, settings),
    enabled: Boolean(range) && settings.sources.length > 0,
    retry: CINECA_QUERY_RETRY,
    retryDelay: cinecaRetryDelay,
  });

  const events: EventInput[] = useMemo(() => {
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
        extendedProps: { dto: ev },
      } satisfies EventInput;
    });
  }, [eventsQuery.data, settings.colors, i18n.language]);

  if (settings.sources.length === 0) {
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
          slotMinTime="07:00:00"
          slotMaxTime="21:00:00"
          dayMaxEvents
          navLinks
          navLinkDayClick={(date) => goToDay(date)}
          views={{ dayGridMonth: { eventDisplay: 'list-item' } }}
          events={events}
          eventContent={eventContent}
          eventClick={(arg) => onEventClick(arg.event.extendedProps.dto as CalendarEventDto)}
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
