import type { ComponentType, SVGProps } from 'react';
import { useTranslation } from 'react-i18next';
import type { CalendarEventDto } from '@planner/shared';
import { IconMapPin, IconPlusCircle, IconRotate, IconTv } from './icons.tsx';

interface Marker {
  key: string;
  Icon: ComponentType<SVGProps<SVGSVGElement>>;
  labelKey: string;
}

// Same symbols Cineca's own calendar shows next to a lesson
export function eventMarkers(event: CalendarEventDto): Marker[] {
  const markers: Marker[] = [];
  if (event.online) markers.push({ key: 'online', Icon: IconTv, labelKey: 'event.online' });
  if (event.extra) markers.push({ key: 'extra', Icon: IconPlusCircle, labelKey: 'event.extra' });
  if (event.makeup) markers.push({ key: 'makeup', Icon: IconRotate, labelKey: 'event.makeup' });
  if (event.offSite) markers.push({ key: 'offSite', Icon: IconMapPin, labelKey: 'event.offSite' });
  return markers;
}

// Icons only, label as tooltip. For cards where text has no room.
export function EventMarkerIcons({ event }: { event: CalendarEventDto }) {
  const { t } = useTranslation();
  const markers = eventMarkers(event);
  if (markers.length === 0) return null;
  return (
    <span className="event-markers">
      {markers.map(({ key, Icon, labelKey }) => (
        <span key={key} role="img" aria-label={t(labelKey)} title={t(labelKey)}>
          <Icon width={12} height={12} />
        </span>
      ))}
    </span>
  );
}

// Icon plus label, for the detail dialog
export function EventMarkerBadges({ event }: { event: CalendarEventDto }) {
  const { t } = useTranslation();
  const markers = eventMarkers(event);
  if (markers.length === 0) return null;
  return (
    <div className="event-badges">
      {markers.map(({ key, Icon, labelKey }) => (
        <span key={key} className="event-badge">
          <Icon />
          {t(labelKey)}
        </span>
      ))}
    </div>
  );
}
