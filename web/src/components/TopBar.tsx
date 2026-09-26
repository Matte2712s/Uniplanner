import { useTranslation } from 'react-i18next';
import type { CalendarMode } from '@planner/shared';
import { usePlanner } from '../state/PlannerContext.tsx';
import { AccountMenu } from './AccountMenu.tsx';
import { IconChevronLeft, IconChevronRight, IconMenu } from './icons.tsx';
import { ViewSwitcher } from './ViewSwitcher.tsx';

const MODES: CalendarMode[] = ['day', 'week', 'month', 'list'];

export function TopBar({
  title,
  mode,
  onModeChange,
  onPrev,
  onNext,
  onToday,
  onToggleSidebar,
}: {
  title: string;
  mode: CalendarMode;
  onModeChange: (mode: CalendarMode) => void;
  onPrev: () => void;
  onNext: () => void;
  onToday: () => void;
  onToggleSidebar: () => void;
}) {
  const { t, i18n } = useTranslation();
  const planner = usePlanner();

  return (
    <div className="top-bar">
      <button className="icon-btn" onClick={onToggleSidebar} aria-label={t('nav.openMenu')}>
        <IconMenu />
      </button>
      <button className="icon-btn" onClick={onPrev} aria-label="prev">
        <IconChevronLeft />
      </button>
      <button className="btn" onClick={onToday}>
        {t('nav.today')}
      </button>
      <button className="icon-btn" onClick={onNext} aria-label="next">
        <IconChevronRight />
      </button>
      <span className="top-bar-title" title={title}>
        {title}
      </span>
      <ViewSwitcher />
      <div className="segmented">
        {MODES.map((m) => (
          <button key={m} aria-pressed={mode === m} onClick={() => onModeChange(m)}>
            {t(`mode.${m}`)}
          </button>
        ))}
      </div>
      <button className="icon-btn" onClick={() => planner.setLang(i18n.language === 'en' ? 'it' : 'en')}>
        {i18n.language === 'en' ? t('lang.it') : t('lang.en')}
      </button>
      {planner.user ? (
        <AccountMenu />
      ) : (
        <button className="btn btn-primary" onClick={planner.login}>
          {t('auth.login')}
        </button>
      )}
    </div>
  );
}
