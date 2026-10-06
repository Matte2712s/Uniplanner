import { useTranslation } from 'react-i18next';
import type { CalendarEventDto } from '@planner/shared';
import { Dialog } from './Dialog.tsx';
import { EventMarkerBadges } from './EventMarkers.tsx';

function formatRange(start: string, end: string, locale: string): string {
  const s = new Date(start);
  const e = new Date(end);
  const day = new Intl.DateTimeFormat(locale, { weekday: 'long', day: 'numeric', month: 'long' }).format(s);
  const time = (d: Date) => new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit' }).format(d);
  return `${day}, ${time(s)} - ${time(e)}`;
}

export function EventDetail({ event, onClose }: { event: CalendarEventDto; onClose: () => void }) {
  const { t, i18n } = useTranslation();
  const name = i18n.language === 'en' && event.courseNameEn ? event.courseNameEn : event.courseName;
  const notes = i18n.language === 'en' && event.notesEn ? event.notesEn : event.notes;

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

      <div className="dialog-actions">
        <button className="btn" onClick={onClose}>
          {t('event.close')}
        </button>
      </div>
    </Dialog>
  );
}
