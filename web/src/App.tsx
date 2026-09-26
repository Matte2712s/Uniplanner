import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { CalendarEventDto, CalendarMode } from '@planner/shared';
import { CalendarView, type CalendarViewHandle } from './components/CalendarView.tsx';
import { EventDetail } from './components/EventDetail.tsx';
import { ImportGuestViewsDialog } from './components/ImportGuestViewsDialog.tsx';
import { Sidebar } from './components/Sidebar.tsx';
import { TopBar } from './components/TopBar.tsx';
import { useIsMobile } from './hooks/useMediaQuery.ts';
import { useResizableSidebar } from './hooks/useResizableSidebar.ts';
import { usePlanner } from './state/PlannerContext.tsx';

export function App() {
  const { t } = useTranslation();
  const planner = usePlanner();
  const isMobile = useIsMobile();
  const sidebarResize = useResizableSidebar();
  const calRef = useRef<CalendarViewHandle>(null);
  const [title, setTitle] = useState('');
  // Open by default on desktop (a fixed side panel), closed by default on
  // mobile (an overlay drawer) - the hamburger toggles either the same way.
  const [sidebarOpen, setSidebarOpen] = useState(() => !window.matchMedia('(max-width: 767px)').matches);
  const [selectedEvent, setSelectedEvent] = useState<CalendarEventDto | null>(null);

  const settings = planner.activeView?.settings;
  if (!settings) {
    // A brand-new account with local guest data waits on this decision
    // before it ever gets a first view, so it must render even though
    // there's nothing else to show yet - otherwise this choice is stuck
    // behind the loading screen forever.
    if (planner.pendingImport) {
      return <ImportGuestViewsDialog count={planner.pendingImport.count} />;
    }
    return <div className="empty-state">{t('loading')}</div>;
  }

  function closeSidebarOnMobile() {
    if (isMobile) setSidebarOpen(false);
  }

  function onModeChange(mode: CalendarMode) {
    if (!settings) return;
    void planner.updateActiveViewSettings({ ...settings, calendarMode: mode });
  }

  return (
    <div className="app">
      <TopBar
        title={title}
        mode={settings.calendarMode}
        onModeChange={onModeChange}
        onPrev={() => calRef.current?.prev()}
        onNext={() => calRef.current?.next()}
        onToday={() => calRef.current?.today()}
        onToggleSidebar={() => setSidebarOpen((v) => !v)}
      />
      <div className="layout">
        {isMobile && sidebarOpen && <div className="sidebar-backdrop" onClick={() => setSidebarOpen(false)} />}
        <div
          className={`sidebar${sidebarOpen ? ' open' : ''}`}
          style={
            !isMobile && sidebarOpen
              ? {
                  width: sidebarResize.width,
                  minWidth: sidebarResize.width,
                  // The CSS width transition is for the open/close collapse;
                  // it would otherwise make an active drag lag behind the pointer.
                  transition: sidebarResize.dragging ? 'none' : undefined,
                }
              : undefined
          }
        >
          <Sidebar onNavigate={closeSidebarOnMobile} />
        </div>
        {!isMobile && sidebarOpen && (
          <div
            className={`sidebar-resize-handle${sidebarResize.dragging ? ' dragging' : ''}`}
            onPointerDown={sidebarResize.onPointerDown}
            onKeyDown={sidebarResize.onKeyDown}
            tabIndex={0}
            role="separator"
            aria-orientation="vertical"
            aria-label={t('sidebar.resize')}
            aria-valuenow={sidebarResize.width}
            aria-valuemin={sidebarResize.min}
            aria-valuemax={sidebarResize.max}
          />
        )}
        <div className="content">
          <div className="calendar-wrap">
            <CalendarView
              ref={calRef}
              settings={settings}
              mode={settings.calendarMode}
              onModeChange={onModeChange}
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
