import { useTranslation } from 'react-i18next';
import { usePlanner } from '../state/PlannerContext.tsx';
import { useDropdown } from '../hooks/useDropdown.ts';
import {
  IconArrowDown,
  IconArrowUp,
  IconCheck,
  IconChevronDown,
  IconCopy,
  IconLayers,
  IconPencil,
  IconPlus,
  IconTrash,
} from './icons.tsx';

export function ViewSwitcher() {
  const { t } = useTranslation();
  const planner = usePlanner();
  const { open, setOpen, ref } = useDropdown();

  function handleNew() {
    const name = window.prompt(t('views.namePlaceholder'));
    if (name?.trim()) void planner.createView(name.trim());
    setOpen(false);
  }

  function handleRename(id: number, current: string) {
    const name = window.prompt(t('views.namePlaceholder'), current);
    if (name?.trim() && name.trim() !== current) void planner.renameView(id, name.trim());
  }

  function handleDelete(id: number, name: string) {
    if (planner.views.length <= 1) return;
    if (window.confirm(t('views.deleteConfirm', { name }))) void planner.deleteView(id);
  }

  function move(index: number, dir: -1 | 1) {
    const order = planner.views.map((v) => v.id);
    const j = index + dir;
    if (j < 0 || j >= order.length) return;
    [order[index], order[j]] = [order[j]!, order[index]!];
    void planner.reorderViews(order);
  }

  return (
    <div className="view-menu" ref={ref}>
      <button className="view-trigger" onClick={() => setOpen((v) => !v)} aria-expanded={open} aria-haspopup="menu">
        <IconLayers className="view-trigger-icon" />
        <span className="view-trigger-name">{planner.activeView?.name ?? t('views.title')}</span>
        <IconChevronDown className={`view-trigger-chevron${open ? ' open' : ''}`} />
      </button>
      {open && (
        <div className="view-menu-list" role="menu">
          <div className="view-menu-heading">{t('views.title')}</div>
          {planner.views.map((v, index) => {
            const active = v.id === planner.activeViewId;
            return (
              <div key={v.id} className={`view-menu-item${active ? ' active' : ''}`}>
                <button
                  className="view-menu-item-main"
                  onClick={() => {
                    planner.setActiveViewId(v.id);
                    setOpen(false);
                  }}
                >
                  <span className="view-menu-item-check">{active && <IconCheck />}</span>
                  <span className="view-menu-item-name">{v.name}</span>
                </button>
                <div className="view-menu-item-actions">
                  <button
                    className="icon-btn icon-btn-sm"
                    title={t('views.moveUp')}
                    onClick={() => move(index, -1)}
                    disabled={index === 0}
                  >
                    <IconArrowUp />
                  </button>
                  <button
                    className="icon-btn icon-btn-sm"
                    title={t('views.moveDown')}
                    onClick={() => move(index, 1)}
                    disabled={index === planner.views.length - 1}
                  >
                    <IconArrowDown />
                  </button>
                  <button className="icon-btn icon-btn-sm" title={t('views.rename')} onClick={() => handleRename(v.id, v.name)}>
                    <IconPencil />
                  </button>
                  <button className="icon-btn icon-btn-sm" title={t('views.duplicate')} onClick={() => void planner.duplicateView(v.id)}>
                    <IconCopy />
                  </button>
                  <button
                    className="icon-btn icon-btn-sm"
                    title={t('views.delete')}
                    onClick={() => handleDelete(v.id, v.name)}
                    disabled={planner.views.length <= 1}
                  >
                    <IconTrash />
                  </button>
                </div>
              </div>
            );
          })}
          <div className="view-menu-divider" />
          {planner.viewsAtLimit ? (
            <p className="hint" style={{ padding: '4px 8px' }}>
              {t('views.limitReached')}
            </p>
          ) : (
            <button className="view-menu-new" onClick={handleNew}>
              <IconPlus />
              {t('views.new')}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
