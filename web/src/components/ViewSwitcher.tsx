import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { MAX_VIEW_NAME_LENGTH } from '@planner/shared';
import type { View } from '@planner/shared';
import { usePlanner } from '../state/PlannerContext.tsx';
import { useDropdown } from '../hooks/useDropdown.ts';
import { DeleteViewDialog } from './DeleteViewDialog.tsx';
import {
  IconArrowDown,
  IconArrowUp,
  IconCheck,
  IconChevronDown,
  IconCopy,
  IconLayers,
  IconPencil,
  IconPlus,
  IconShare,
  IconTrash,
} from './icons.tsx';
import { NameDialog } from './NameDialog.tsx';
import { ShareViewDialog } from './ShareViewDialog.tsx';

export function ViewSwitcher() {
  const { t } = useTranslation();
  const planner = usePlanner();
  const { open, setOpen, ref } = useDropdown();
  const [sharing, setSharing] = useState<View | null>(null);
  const [naming, setNaming] = useState<{ mode: 'new' } | { mode: 'rename'; view: View } | null>(null);
  const [deleting, setDeleting] = useState<View | null>(null);

  function handleNew() {
    setNaming({ mode: 'new' });
    setOpen(false);
  }

  function handleNameSubmit(name: string) {
    if (naming?.mode === 'new') void planner.createView(name);
    else if (naming?.mode === 'rename' && name !== naming.view.name) void planner.renameView(naming.view.id, name);
    setNaming(null);
  }

  function handleDeleteConfirm() {
    if (deleting && planner.views.length > 1) void planner.deleteView(deleting.id);
    setDeleting(null);
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
                  <button className="icon-btn icon-btn-sm" title={t('views.rename')} onClick={() => setNaming({ mode: 'rename', view: v })}>
                    <IconPencil />
                  </button>
                  <button className="icon-btn icon-btn-sm" title={t('views.duplicate')} onClick={() => void planner.duplicateView(v.id)}>
                    <IconCopy />
                  </button>
                  {planner.user && (
                    <button className="icon-btn icon-btn-sm" title={t('views.share')} onClick={() => setSharing(v)}>
                      <IconShare />
                    </button>
                  )}
                  <button
                    className="icon-btn icon-btn-sm"
                    title={t('views.delete')}
                    onClick={() => setDeleting(v)}
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
      {naming && (
        <NameDialog
          title={naming.mode === 'new' ? t('views.new') : t('views.rename')}
          label={t('views.namePlaceholder')}
          initialValue={naming.mode === 'rename' ? naming.view.name : ''}
          maxLength={MAX_VIEW_NAME_LENGTH}
          onSubmit={handleNameSubmit}
          onCancel={() => setNaming(null)}
        />
      )}
      {deleting && (
        <DeleteViewDialog viewName={deleting.name} onConfirm={handleDeleteConfirm} onCancel={() => setDeleting(null)} />
      )}
      {sharing && (
        <ShareViewDialog
          view={planner.views.find((v) => v.id === sharing.id) ?? sharing}
          onClose={() => setSharing(null)}
        />
      )}
    </div>
  );
}
