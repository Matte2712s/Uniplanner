import { useTranslation } from 'react-i18next';
import type { CalendarEventDto, HiddenRule } from '@planner/shared';
import { weeklySlotOf } from '@planner/shared';
import { Dialog } from './Dialog.tsx';
import { EventMarkerBadges } from './EventMarkers.tsx';

function formatRange(start: string, end: string, locale: string): string {
  const s = new Date(start);
  const e = new Date(end);
  const day = new Intl.DateTimeFormat(locale, { weekday: 'long', day: 'numeric', month: 'long' }).format(s);
  const time = (d: Date) => new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit' }).format(d);
  return `${day}, ${time(s)} - ${time(e)}`;
}

// ISO weekday (1 = Monday) as a name; 2024-01-01 is a Monday
function weekdayName(weekday: number, locale: string): string {
  return new Intl.DateTimeFormat(locale, { weekday: 'long', timeZone: 'UTC' }).format(new Date(Date.UTC(2024, 0, weekday)));
}

export function EventDetail({
  event,
  hiding,
  onClose,
}: {
  event: CalendarEventDto;
  // Owner only: without it (share links) the dialog offers no way to hide the lesson
  hiding?: { rules: HiddenRule[]; onHide: (kind: 'once' | 'weekly') => void; onUnhide: () => void };
  onClose: () => void;
}) {
  const { t, i18n } = useTranslation();
  const name = i18n.language === 'en' && event.courseNameEn ? event.courseNameEn : event.courseName;
  const notes = i18n.language === 'en' && event.notesEn ? event.notesEn : event.notes;
  const isHidden = hiding !== undefined && hiding.rules.length > 0;
  // A matching weekly rule shares the lesson's own slot, so the slot of the lesson says the same
  const slot = weeklySlotOf(event.start);
  const slotText = { weekday: weekdayName(slot.weekday, i18n.language), time: slot.time };

  return (
    <Dialog onClose={onClose}>
      <h2>{name}</h2>
      <p className="hint">{formatRange(event.start, event.end, i18n.language)}</p>

      {event.status === 'cancelled' && <p className="error-text">{t('event.cancelled')}</p>}
      {event.status === 'suspended' && <p className="error-text">{t('event.suspended')}</p>}
      <EventMarkerBadges event={event} />

      {event.activity && <p className="hint">{event.activity}</p>}

      {event.teachers.length > 0 && (
        <div className="field">
          <label>{t('event.teachers')}</label>
          <div>{event.teachers.join(', ')}</div>
        </div>
      )}

      {event.rooms.length > 0 && (
        <div className="field">
          <label>{t('event.rooms')}</label>
          <div>{event.rooms.map((r) => (r.building ? `${r.name} (${r.building})` : r.name)).join(', ')}</div>
        </div>
      )}

      {notes && (
        <div className="field">
          <label>{t('event.notes')}</label>
          <div>{notes}</div>
        </div>
      )}

      {event.onlineUrl && (
        <p>
          <a href={event.onlineUrl} target="_blank" rel="noopener noreferrer">
            {t('event.joinOnline')}
          </a>
        </p>
      )}

      {isHidden && (
        <p className="hint">
          {hiding.rules.some((rule) => rule.kind === 'weekly') ? t('event.hiddenWeeklyNote', slotText) : t('event.hiddenNote')}
        </p>
      )}

      <div className="dialog-actions">
        {hiding && !isHidden && (
          <>
            <button className="btn" onClick={() => hiding.onHide('once')}>
              {t('event.hide')}
            </button>
            <button className="btn" onClick={() => hiding.onHide('weekly')}>
              {t('event.hideWeekly', slotText)}
            </button>
          </>
        )}
        {isHidden && (
          <button className="btn btn-primary" onClick={hiding.onUnhide}>
            {t('event.unhide')}
          </button>
        )}
        <button className="btn" onClick={onClose}>
          {t('event.close')}
        </button>
      </div>
    </Dialog>
  );
}
