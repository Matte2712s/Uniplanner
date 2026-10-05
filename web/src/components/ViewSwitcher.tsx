import {
  closestCenter,
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  pointerWithin,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import type { CollisionDetection, DragEndEvent, DragStartEvent } from '@dnd-kit/core';
import { useCallback, useState } from 'react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { MAX_VIEW_NAME_LENGTH } from '@planner/shared';
import type { View } from '@planner/shared';
import { usePlanner } from '../state/PlannerContext.tsx';
import { useDropdown } from '../hooks/useDropdown.ts';
import { DeleteViewDialog } from './DeleteViewDialog.tsx';
import {
  IconCheck,
  IconChevronDown,
  IconCopy,
  IconGripVertical,
  IconLayers,
  IconPencil,
  IconPlus,
  IconShare,
  IconTrash,
} from './icons.tsx';
import { NameDialog } from './NameDialog.tsx';
import { ShareViewDialog } from './ShareViewDialog.tsx';

// Pointer drags need a row under the cursor; keyboard drags have no pointer, so take the nearest row
const collisionDetection: CollisionDetection = (args) => (args.pointerCoordinates ? pointerWithin(args) : closestCenter(args));

// A view row that can be dragged by its handle and dropped onto another row
function SortableViewItem({
  id,
  index,
  dragIndex,
  active,
  disabled,
  children,
}: {
  id: number;
  index: number;
  // Index of the view being dragged, if any
  dragIndex: number | null;
  active: boolean;
  disabled: boolean;
  children: ReactNode;
}) {
  const { t } = useTranslation();
  const { attributes, listeners, setNodeRef: setDragRef, setActivatorNodeRef, isDragging } = useDraggable({ id, disabled });
  const { setNodeRef: setDropRef, isOver } = useDroppable({ id });
  // The whole row is the dragged node (so the overlay matches its size); only the handle starts a drag
  const setRowRef = useCallback(
    (node: HTMLDivElement | null) => {
      setDragRef(node);
      setDropRef(node);
    },
    [setDragRef, setDropRef],
  );

  // Line marks where the dragged view lands: below when moving down, above when moving up
  const edge = isOver && dragIndex !== null && dragIndex !== index ? (dragIndex < index ? ' drop-after' : ' drop-before') : '';

  return (
    <div ref={setRowRef} className={`view-menu-item${active ? ' active' : ''}${edge}`} style={{ opacity: isDragging ? 0.4 : 1 }}>
      <button
        className="drag-handle"
        ref={setActivatorNodeRef}
        {...attributes}
        {...listeners}
        disabled={disabled}
        aria-label={t('views.dragHandle')}
      >
        <IconGripVertical />
      </button>
      {children}
    </div>
  );
}

export function ViewSwitcher() {
  const { t } = useTranslation();
  const planner = usePlanner();
  const { open, setOpen, ref } = useDropdown();
  const [sharing, setSharing] = useState<View | null>(null);
  const [naming, setNaming] = useState<{ mode: 'new' } | { mode: 'rename'; view: View } | null>(null);
  const [deleting, setDeleting] = useState<View | null>(null);
  const [draggingId, setDraggingId] = useState<number | null>(null);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 8 } }), useSensor(KeyboardSensor));
  const dragIndex = draggingId !== null ? planner.views.findIndex((v) => v.id === draggingId) : null;
  const draggingView = dragIndex !== null ? planner.views[dragIndex] : undefined;

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

  function handleDragStart(event: DragStartEvent) {
    setDraggingId(Number(event.active.id));
  }

  function handleDragEnd(event: DragEndEvent) {
    setDraggingId(null);
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const order = planner.views.map((v) => v.id);
    const from = order.indexOf(Number(active.id));
    const to = order.indexOf(Number(over.id));
    if (from < 0 || to < 0) return;
    order.splice(to, 0, order.splice(from, 1)[0]!);
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
          <DndContext
            sensors={sensors}
            collisionDetection={collisionDetection}
            onDragStart={handleDragStart}
            onDragEnd={handleDragEnd}
            onDragCancel={() => setDraggingId(null)}
          >
            {planner.views.map((v, index) => {
              const active = v.id === planner.activeViewId;
              return (
                <SortableViewItem key={v.id} id={v.id} index={index} dragIndex={dragIndex} active={active} disabled={planner.views.length <= 1}>
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
                </SortableViewItem>
              );
            })}
            <DragOverlay>
              {draggingView && (
                <div className="drag-overlay-card">
                  <span>{draggingView.name}</span>
                </div>
              )}
            </DragOverlay>
          </DndContext>
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
