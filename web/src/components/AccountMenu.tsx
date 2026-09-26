import { useTranslation } from 'react-i18next';
import { useDropdown } from '../hooks/useDropdown.ts';
import { usePlanner } from '../state/PlannerContext.tsx';
import { IconLogout } from './icons.tsx';

function initialsOf(text: string): string {
  const parts = text.trim().split(/\s+/).filter(Boolean);
  const first = parts[0]?.[0] ?? '';
  const last = parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? '') : '';
  return (first + last).toUpperCase() || '?';
}

function Avatar({ name, pictureUrl, size }: { name: string; pictureUrl: string | null; size: 'sm' | 'lg' }) {
  const cls = `avatar${size === 'lg' ? ' avatar-lg' : ''}`;
  if (pictureUrl) {
    return <img className={cls} src={pictureUrl} alt="" referrerPolicy="no-referrer" />;
  }
  return <span className={`${cls} avatar-fallback`}>{initialsOf(name)}</span>;
}

export function AccountMenu() {
  const { t } = useTranslation();
  const planner = usePlanner();
  const { open, setOpen, ref } = useDropdown();

  if (!planner.user) return null;
  const { name, email, pictureUrl } = planner.user;

  return (
    <div className="account-menu" ref={ref}>
      <button
        className="avatar-btn"
        onClick={() => setOpen((v) => !v)}
        aria-label={t('auth.account')}
        aria-haspopup="menu"
        aria-expanded={open}
        title={name}
      >
        <Avatar name={name} pictureUrl={pictureUrl} size="sm" />
      </button>
      {open && (
        <div className="account-card" role="menu">
          <div className="account-card-header">
            <Avatar name={name} pictureUrl={pictureUrl} size="lg" />
            <div className="account-card-info">
              <div className="account-name">{name}</div>
              <div className="account-email">{email}</div>
            </div>
          </div>
          <div className="view-menu-divider" />
          <button
            className="view-menu-new"
            onClick={() => {
              setOpen(false);
              void planner.logout();
            }}
          >
            <IconLogout />
            {t('auth.logout')}
          </button>
        </div>
      )}
    </div>
  );
}
