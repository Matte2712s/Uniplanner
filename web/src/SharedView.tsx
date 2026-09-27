import { useQuery } from '@tanstack/react-query';
import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { CalendarEventDto, CalendarMode } from '@planner/shared';
import { CalendarView, type CalendarViewHandle } from './components/CalendarView.tsx';
import { EventDetail } from './components/EventDetail.tsx';
import { IconChevronLeft, IconChevronRight } from './components/icons.tsx';
import { api } from './api/client.ts';

const MODES: CalendarMode[] = ['day', 'week', 'month', 'list'];

export function SharedView({ token }: { token: string }) {
  const { t } = useTranslation();
  const calRef = useRef<CalendarViewHandle>(null);
  const [title, setTitle] = useState('');
  const [selectedEvent, setSelectedEvent] = useState<CalendarEventDto | null>(null);
  // Local-only, unlike the signed-in app: a visitor can flip week/day/month
  // views while browsing, but there's nothing to persist it to.
  const [mode, setMode] = useState<CalendarMode>('week');

  const query = useQuery({
    queryKey: ['shared', token],
    queryFn: () => api.sharedView(token),
    retry: false,
  });

  if (query.isLoading) return <div className="empty-state">{t('loading')}</div>;
  if (!query.data) return <div className="empty-state">{t('shared.notFound')}</div>;
  // CalendarView's own empty state points at "the sidebar" to add a source,
  // which doesn't exist on this read-only page - show a page-appropriate one instead.
  if (query.data.settings.sources.length === 0) return <div className="empty-state">{t('shared.noSources')}</div>;

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
            />
          </div>
        </div>
      </div>
      {selectedEvent && <EventDetail event={selectedEvent} onClose={() => setSelectedEvent(null)} />}
    </div>
  );
}
