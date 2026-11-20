import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { CalendarEventDto, CalendarMode, CustomEventDto, CustomEventOccurrence } from '@planner/shared';
import {
  CalendarView,
  type CalendarCustomEvent,
  type CalendarViewHandle,
  type SlotSelection,
} from './components/CalendarView.tsx';
import { CustomEventDetail } from './components/CustomEventDetail.tsx';
import { CustomEventDialog } from './components/CustomEventDialog.tsx';
import { EventDetail } from './components/EventDetail.tsx';
import { ImportGuestViewsDialog } from './components/ImportGuestViewsDialog.tsx';
import { ManageEventsDialog } from './components/ManageEventsDialog.tsx';
import { Sidebar } from './components/Sidebar.tsx';
import { TopBar } from './components/TopBar.tsx';
import { useIsMobile } from './hooks/useMediaQuery.ts';
import { useResizableSidebar } from './hooks/useResizableSidebar.ts';
import { addDays, localDateString, localTimeString } from './lib/customEventFormat.ts';
import type { CustomEventDraft } from './lib/customEventForm.ts';
import { usePlanner } from './state/PlannerContext.tsx';

interface EditorState {
  initial: CustomEventDto | null;
  draft?: CustomEventDraft;
}

// Drag selections arrive as browser-zone dates; an all-day end is exclusive
function draftFromSelection(selection: SlotSelection): CustomEventDraft {
  const startDate = localDateString(selection.start);
  if (selection.allDay) {
    return { schedule: { kind: 'allDay', startDate, endDate: addDays(localDateString(selection.end), -1) } };
  }
  return {
    schedule: {
      kind: 'once',
      startDate,
      startTime: localTimeString(selection.start),
      endDate: localDateString(selection.end),
      endTime: localTimeString(selection.end),
    },
  };
}

// A copy has no id, so saving it creates a new event
function draftFromEvent(event: CustomEventDto): CustomEventDraft {
  return {
    title: event.title,
    notes: event.notes,
    location: event.location,
    url: event.url,
    labelId: event.labelId,
    color: event.color,
    timeZone: event.timeZone,
    schedule: event.schedule,
  };
}

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
  const [selectedCustom, setSelectedCustom] = useState<{ event: CalendarCustomEvent; occurrence: CustomEventOccurrence } | null>(null);
  const [editor, setEditor] = useState<EditorState | null>(null);
  const [manageOpen, setManageOpen] = useState(false);

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

  function openEditor(next: EditorState) {
    setSelectedCustom(null);
    setManageOpen(false);
    setEditor(next);
  }

  // The detail holds a calendar snapshot; editing needs the stored event
  function storedEvent(event: CalendarCustomEvent): CustomEventDto | undefined {
    return planner.customEvents.find((e) => e.id === event.id);
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
          <Sidebar
            onNavigate={closeSidebarOnMobile}
            onNewEvent={() => {
              closeSidebarOnMobile();
              openEditor({ initial: null });
            }}
            onManageEvents={() => {
              closeSidebarOnMobile();
              setManageOpen(true);
            }}
          />
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
              customEvents={{ events: planner.customEvents, labels: planner.eventLabels }}
              onCustomEventClick={(event, occurrence) => setSelectedCustom({ event, occurrence })}
              onSlotSelect={(selection) => openEditor({ initial: null, draft: draftFromSelection(selection) })}
            />
          </div>
        </div>
      </div>

      {selectedEvent && <EventDetail event={selectedEvent} onClose={() => setSelectedEvent(null)} />}

      {selectedCustom && (
        <CustomEventDetail
          event={selectedCustom.event}
          occurrence={selectedCustom.occurrence}
          labels={planner.eventLabels}
          onClose={() => setSelectedCustom(null)}
          onEdit={() => {
            const stored = storedEvent(selectedCustom.event);
            if (stored) openEditor({ initial: stored });
            else setSelectedCustom(null);
          }}
          onDuplicate={() => {
            const stored = storedEvent(selectedCustom.event);
            if (stored) openEditor({ initial: null, draft: draftFromEvent(stored) });
            else setSelectedCustom(null);
          }}
        />
      )}

      {manageOpen && (
        <ManageEventsDialog onClose={() => setManageOpen(false)} onEdit={(event) => openEditor({ initial: event })} />
      )}

      {editor && <CustomEventDialog initial={editor.initial} draft={editor.draft} onClose={() => setEditor(null)} />}
    </div>
  );
}
