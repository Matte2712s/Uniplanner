import { useQuery } from '@tanstack/react-query';
import { useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { CalendarEventDto, CalendarMode, CustomEventOccurrence, SharedCustomEventDto, SharedCustomEventsDto } from '@planner/shared';
import { CalendarView, type CalendarViewHandle } from './components/CalendarView.tsx';
import { CustomEventDetail } from './components/CustomEventDetail.tsx';
import { EventDetail } from './components/EventDetail.tsx';
import { IconChevronLeft, IconChevronRight } from './components/icons.tsx';
import { api } from './api/client.ts';

const MODES: CalendarMode[] = ['day', 'week', 'month', 'list'];

// Stable references while the custom-events request is loading or has failed
const NO_EVENTS: SharedCustomEventDto[] = [];
const NO_LABELS: SharedCustomEventsDto['labels'] = [];

export function SharedView({ token }: { token: string }) {
  const { t } = useTranslation();
  const calRef = useRef<CalendarViewHandle>(null);
  const [title, setTitle] = useState('');
  const [selectedEvent, setSelectedEvent] = useState<CalendarEventDto | null>(null);
  const [selectedCustom, setSelectedCustom] = useState<{ event: SharedCustomEventDto; occurrence: CustomEventOccurrence } | null>(null);
  // Local-only, unlike the signed-in app: a visitor can flip week/day/month
  // views while browsing, but there's nothing to persist it to.
  const [mode, setMode] = useState<CalendarMode>('week');

  const query = useQuery({
    queryKey: ['shared', token],
    queryFn: () => api.sharedView(token),
    retry: false,
  });

  // Optional extra: the timetable must keep working when this request fails
  const customQuery = useQuery({
    queryKey: ['shared-custom-events', token],
    queryFn: () => api.sharedCustomEvents(token),
    retry: false,
  });
  const customEvents = useMemo(
    () => ({ events: customQuery.data?.events ?? NO_EVENTS, labels: customQuery.data?.labels ?? NO_LABELS }),
    [customQuery.data],
  );

  if (query.isLoading) return <div className="empty-state">{t('loading')}</div>;
  if (!query.data) return <div className="empty-state">{t('shared.notFound')}</div>;
  // CalendarView's own empty state points at "the sidebar" to add a source,
  // which doesn't exist on this read-only page - show a page-appropriate one instead.
  // A view with only custom events is not empty.
  if (query.data.settings.sources.length === 0) {
    if (customQuery.isLoading) return <div className="empty-state">{t('loading')}</div>;
    if (customEvents.events.length === 0) return <div className="empty-state">{t('shared.noSources')}</div>;
  }

  const settings = { ...query.data.settings, calendarMode: mode };

  return (
    <div className="app">
      <div className="top-bar">
        <span className="app-brand">{t('app.title')}</span>
        <button className="icon-btn" onClick={() => calRef.current?.prev()} aria-label="prev">
          <IconChevronLeft />
        </button>
        <button className="btn" onClick={() => calRef.current?.today()}>
          {t('nav.today')}
        </button>
        <button className="icon-btn" onClick={() => calRef.current?.next()} aria-label="next">
          <IconChevronRight />
        </button>
        <span className="top-bar-title" title={title}>
          {title}
        </span>
        <span className="top-bar-title">{query.data.name}</span>
        <div className="segmented">
          {MODES.map((m) => (
            <button key={m} aria-pressed={mode === m} onClick={() => setMode(m)}>
              {t(`mode.${m}`)}
            </button>
          ))}
        </div>
      </div>
      <div className="layout">
        <div className="content">
          <div className="calendar-wrap">
            <CalendarView
              ref={calRef}
              settings={settings}
              mode={mode}
              onModeChange={setMode}
              onTitleChange={setTitle}
              onEventClick={setSelectedEvent}
              customEvents={customEvents}
              onCustomEventClick={(event, occurrence) => setSelectedCustom({ event, occurrence })}
            />
          </div>
        </div>
      </div>
      {selectedEvent && <EventDetail event={selectedEvent} onClose={() => setSelectedEvent(null)} />}
      {selectedCustom && (
        <CustomEventDetail
          readOnly
          event={selectedCustom.event}
          occurrence={selectedCustom.occurrence}
          labels={customEvents.labels}
          onClose={() => setSelectedCustom(null)}
        />
      )}
    </div>
  );
}
