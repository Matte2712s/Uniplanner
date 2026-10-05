import { DndContext, DragOverlay, PointerSensor, pointerWithin, rectIntersection, useDroppable, useSensor, useSensors } from '@dnd-kit/core';
import type { CollisionDetection, DragEndEvent, DragStartEvent } from '@dnd-kit/core';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { FolderDto, PlacedSource, SiblingRef, SourceDto, ViewSettings } from '@planner/shared';
import {
  buildFolderTree,
  childrenOf,
  collectSubtreeIds,
  folderNameSchema,
  isSelfOrDescendant,
  MAX_FOLDER_NAME_LENGTH,
  MAX_SOURCE_NAME_LENGTH,
  siblingOrderAfterMove,
  slotIndex,
  sourceNameSchema,
} from '@planner/shared';
import { usePlanner } from '../state/PlannerContext.tsx';
import { AddSourceDialog } from './AddSourceDialog.tsx';
import { DeleteFolderDialog } from './DeleteFolderDialog.tsx';
import { DeleteSourceDialog } from './DeleteSourceDialog.tsx';
import { ErrorDialog } from './ErrorDialog.tsx';
import { FolderTree, parseSiblingSlotId, type SlotEdge } from './FolderTree.tsx';
import { IconFolder } from './icons.tsx';
import { MoveConfirmDialog } from './MoveConfirmDialog.tsx';
import { NameDialog } from './NameDialog.tsx';
import { SourceBlock } from './SourceBlock.tsx';

type DragData = { kind: 'source'; source: SourceDto } | { kind: 'folder'; folder: FolderDto };

type PendingMove =
  | { kind: 'source'; source: SourceDto; targetFolderId: number | null; targetName: string | null; index?: number }
  | { kind: 'folder'; folder: FolderDto; targetFolderId: number | null; targetName: string | null; index?: number };

type FolderNaming = { mode: 'new'; parentId: number | null } | { mode: 'rename'; folderId: number; currentName: string };

interface PendingDelete {
  folder: FolderDto;
  subfolderCount: number;
  sourceCount: number;
}

const siblingKey = (item: SiblingRef) => `${item.kind}:${item.id}`;

// Placed by pointer so the thin before/after slots stay reachable, and a slot wins over the folder header or source it overlaps
const collisionDetection: CollisionDetection = (args) => {
  const hits = pointerWithin(args);
  const slot = hits.find((hit) => parseSiblingSlotId(String(hit.id)));
  if (slot) return [slot];
  if (args.active.data.current?.kind === 'folder') return hits;
  // A dragged source can also drop onto a folder header by overlap alone
  return rectIntersection({ ...args, droppableContainers: args.droppableContainers.filter((c) => !parseSiblingSlotId(String(c.id))) });
};

function RootDropZone({ active }: { active: boolean }) {
  const { t } = useTranslation();
  const { setNodeRef, isOver } = useDroppable({ id: 'root-drop' });
  if (!active) return null;
  return (
    <div ref={setNodeRef} className={`root-drop-zone${isOver ? ' drop-target' : ''}`}>
      {t('folders.dropToRoot')}
    </div>
  );
}

export function Sidebar({ onNavigate }: { onNavigate?: () => void }) {
  const { t, i18n } = useTranslation();
  const planner = usePlanner();
  const [addOpen, setAddOpen] = useState(false);
  const [pendingMove, setPendingMove] = useState<PendingMove | null>(null);
  const [pendingDelete, setPendingDelete] = useState<PendingDelete | null>(null);
  const [folderNaming, setFolderNaming] = useState<FolderNaming | null>(null);
  const [renamingSource, setRenamingSource] = useState<SourceDto | null>(null);
  const [actionFailed, setActionFailed] = useState(false);
  const [pendingDeleteSource, setPendingDeleteSource] = useState<SourceDto | null>(null);
  const [dragging, setDragging] = useState<DragData | null>(null);
  const settings = planner.activeView?.settings;

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 8 } }));

  if (!settings) return null;
  const onChange = (next: ViewSettings) => void planner.updateActiveViewSettings(next);

  function sourceDisplayName(source: SourceDto): string {
    return source.displayName || (i18n.language === 'en' ? source.titleEn || source.title : source.title);
  }

  const all = [...planner.sources.defaults, ...planner.sources.custom];

  const sourcesByFolder = new Map<number, SourceDto[]>();
  const rootSources: SourceDto[] = [];
  for (const s of all) {
    if (s.folderId == null) {
      rootSources.push(s);
      continue;
    }
    const bucket = sourcesByFolder.get(s.folderId);
    if (bucket) bucket.push(s);
    else sourcesByFolder.set(s.folderId, [s]);
  }
  const placed: PlacedSource[] = all.map((s) => ({ id: s.id, folderId: s.folderId, position: s.position }));
  const rootDefaults = rootSources.filter((s) => s.kind === 'default');
  const rootCustom = rootSources.filter((s) => s.kind === 'custom');

  const tree = buildFolderTree(planner.folders);
  const expandedByDefault = new Set(
    planner.folders
      .filter((f) => (sourcesByFolder.get(f.id) ?? []).some((s) => settings.sources.some((vs) => vs.sourceId === s.id)))
      .map((f) => f.id),
  );

  function requestMove(current: PendingMove) {
    if (current.kind === 'source' && current.source.folderId === current.targetFolderId) return;
    if (current.kind === 'folder' && current.folder.parentId === current.targetFolderId) return;
    setPendingMove(current);
  }

  function handleDragStart(event: DragStartEvent) {
    const data = event.active.data.current as DragData | undefined;
    if (data) setDragging(data);
  }

  // Place a folder or source before/after a sibling slot; a different parent is a move, so it still asks first
  function placeBeside(dragged: DragData, edge: SlotEdge, neighbor: SiblingRef) {
    const parentId = neighbor.kind === 'folder' ? planner.folders.find((f) => f.id === neighbor.id)?.parentId : all.find((x) => x.id === neighbor.id)?.folderId;
    if (parentId === undefined) return;
    // Sources only live in folders; the list below the tree isn't ordered
    if (dragged.kind === 'source' && parentId == null) return;
    if (dragged.kind === 'folder' && parentId != null && isSelfOrDescendant(planner.folders, dragged.folder.id, parentId)) return;

    const moved: SiblingRef = dragged.kind === 'folder' ? { kind: 'folder', id: dragged.folder.id } : { kind: 'source', id: dragged.source.id };
    const index = slotIndex(planner.folders, placed, moved, neighbor, parentId, edge);
    const currentParentId = dragged.kind === 'folder' ? dragged.folder.parentId : dragged.source.folderId;

    if (parentId !== currentParentId) {
      const parent = parentId != null ? planner.folders.find((f) => f.id === parentId) : undefined;
      setPendingMove({ ...dragged, targetFolderId: parentId, targetName: parent?.name ?? null, index });
      return;
    }
    // Reorder within the same parent: skip when it would land where it already is
    const unchanged =
      siblingOrderAfterMove(planner.folders, placed, moved, parentId, index).map(siblingKey).join() ===
      childrenOf(planner.folders, placed, parentId).map(siblingKey).join();
    if (unchanged) return;
    if (dragged.kind === 'folder') void reportFailure(() => planner.moveFolder(dragged.folder.id, parentId, index));
    else void reportFailure(() => planner.setSourcePlacement(dragged.source.id, parentId, index));
  }

  function handleDragEnd(event: DragEndEvent) {
    setDragging(null);
    const over = event.over;
    const data = event.active.data.current as DragData | undefined;
    if (!over || !data) return;

    const overId = String(over.id);
    const slot = parseSiblingSlotId(overId);
    if (slot) return placeBeside(data, slot.edge, slot.neighbor);

    const targetFolderId = overId === 'root-drop' ? null : overId.startsWith('folder-drop-') ? Number(overId.slice('folder-drop-'.length)) : undefined;
    if (targetFolderId === undefined) return;
    const targetFolder = targetFolderId != null ? planner.folders.find((f) => f.id === targetFolderId) : undefined;
    if (targetFolderId != null && !targetFolder) return;
    if (data.kind === 'folder' && targetFolderId != null && isSelfOrDescendant(planner.folders, data.folder.id, targetFolderId)) return;

    requestMove({ ...data, targetFolderId, targetName: targetFolder?.name ?? null });
  }

  async function confirmPendingMove() {
    if (!pendingMove) return;
    const move = pendingMove;
    if (move.kind === 'source') await reportFailure(() => planner.setSourcePlacement(move.source.id, move.targetFolderId, move.index));
    else await reportFailure(() => planner.moveFolder(move.folder.id, move.targetFolderId, move.index));
    setPendingMove(null);
  }

  function handleRename(folderId: number, currentName: string) {
    setFolderNaming({ mode: 'rename', folderId, currentName });
  }

  function handleNewFolder(parentId: number | null) {
    if (planner.foldersAtLimit) return;
    setFolderNaming({ mode: 'new', parentId });
  }

  function handleFolderNameSubmit(name: string) {
    if (folderNaming?.mode === 'new') void reportFailure(() => planner.createFolder(name, folderNaming.parentId));
    else if (folderNaming?.mode === 'rename' && name !== folderNaming.currentName) void reportFailure(() => planner.renameFolder(folderNaming.folderId, name));
    setFolderNaming(null);
  }

  // Server failures surface in the themed error dialog
  async function reportFailure(action: () => Promise<unknown>) {
    try {
      await action();
    } catch {
      setActionFailed(true);
    }
  }

  function requestRenameSource(source: SourceDto) {
    setRenamingSource(source);
  }

  function handleSourceNameSubmit(name: string) {
    if (renamingSource && name !== sourceDisplayName(renamingSource)) void reportFailure(() => planner.renameSource(renamingSource.id, name));
    setRenamingSource(null);
  }

  function requestDeleteSource(source: SourceDto) {
    setPendingDeleteSource(source);
  }

  async function confirmDeleteSource() {
    if (!pendingDeleteSource) return;
    await reportFailure(() => planner.removeSource(pendingDeleteSource.id));
    setPendingDeleteSource(null);
  }

  function requestDeleteFolder(folder: FolderDto) {
    const subtreeIds = collectSubtreeIds(planner.folders, folder.id);
    const affected = new Set([folder.id, ...subtreeIds]);
    const sourceCount = all.filter((s) => s.folderId != null && affected.has(s.folderId)).length;
    if (subtreeIds.length === 0 && sourceCount === 0) {
      void reportFailure(() => planner.deleteFolder(folder.id));
      return;
    }
    setPendingDelete({ folder, subfolderCount: subtreeIds.length, sourceCount });
  }

  async function confirmDeleteFolder() {
    if (!pendingDelete) return;
    await reportFailure(() => planner.deleteFolder(pendingDelete.folder.id));
    setPendingDelete(null);
  }

  return (
    <>
      <div className="sidebar-scroll">
        <div className="section-title">{t('sidebar.sources')}</div>

        <DndContext sensors={sensors} collisionDetection={collisionDetection} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
          <FolderTree
            nodes={tree}
            sourcesByFolder={sourcesByFolder}
            expandedByDefault={expandedByDefault}
            settings={settings}
            onChange={onChange}
            onRemoveSource={requestDeleteSource}
            onRenameSource={requestRenameSource}
            onRename={handleRename}
            onNewSubfolder={handleNewFolder}
            newSubfolderDisabled={planner.foldersAtLimit}
            onDeleteRequest={requestDeleteFolder}
          />

          {rootDefaults.map((s) => (
            <SourceBlock
              key={s.id}
              source={s}
              settings={settings}
              onChange={onChange}
              onRemove={() => requestDeleteSource(s)}
              onRename={() => requestRenameSource(s)}
            />
          ))}

          {rootCustom.length > 0 && <div className="section-title">{t('sidebar.customSources')}</div>}
          {rootCustom.map((s) => (
            <SourceBlock
              key={s.id}
              source={s}
              settings={settings}
              onChange={onChange}
              onRemove={() => requestDeleteSource(s)}
              onRename={() => requestRenameSource(s)}
            />
          ))}

          <RootDropZone active={dragging !== null} />

          <DragOverlay>
            {dragging && (
              <div className="drag-overlay-card">
                {dragging.kind === 'folder' && <IconFolder />}
                <span>{dragging.kind === 'folder' ? dragging.folder.name : sourceDisplayName(dragging.source)}</span>
              </div>
            )}
          </DragOverlay>
        </DndContext>

        <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
          <button className="btn" style={{ flex: 1 }} onClick={() => setAddOpen(true)}>
            + {t('sidebar.addSource')}
          </button>
          <button className="btn" onClick={() => handleNewFolder(null)} disabled={planner.foldersAtLimit}>
            + {t('folders.new')}
          </button>
        </div>

        <div className="section-title">{t('sidebar.options')}</div>
        <label className="checkbox-row" style={{ marginBottom: 8 }}>
          <input
            type="checkbox"
            checked={settings.hideWeekends}
            onChange={(e) => void planner.updateActiveViewSettings({ ...settings, hideWeekends: e.target.checked })}
          />
          {t('sidebar.hideWeekends')}
        </label>
        <label className="checkbox-row">
          <input
            type="checkbox"
            checked={settings.showCancelled}
            onChange={(e) => void planner.updateActiveViewSettings({ ...settings, showCancelled: e.target.checked })}
          />
          {t('sidebar.showCancelled')}
        </label>
      </div>

      <div className="legal-links">
        <a href="/privacy.html">{t('legal.privacy')}</a>
        <a href="/terms.html">{t('legal.terms')}</a>
      </div>

      {addOpen && (
        <AddSourceDialog
          onClose={() => setAddOpen(false)}
          onAdded={() => {
            onNavigate?.();
          }}
        />
      )}

      {folderNaming && (
        <NameDialog
          title={folderNaming.mode === 'rename' ? t('folders.rename') : folderNaming.parentId != null ? t('folders.newSubfolder') : t('folders.new')}
          label={folderNaming.mode === 'new' && folderNaming.parentId != null ? t('folders.subfolderNamePlaceholder') : t('folders.namePlaceholder')}
          initialValue={folderNaming.mode === 'rename' ? folderNaming.currentName : ''}
          maxLength={MAX_FOLDER_NAME_LENGTH}
          validate={(name) => folderNameSchema.safeParse(name).success}
          invalidMessage={t('folders.invalidName')}
          onSubmit={handleFolderNameSubmit}
          onCancel={() => setFolderNaming(null)}
        />
      )}

      {renamingSource && (
        <NameDialog
          title={t('sidebar.renameSource')}
          label={t('sidebar.renameSourcePlaceholder')}
          initialValue={sourceDisplayName(renamingSource)}
          maxLength={MAX_SOURCE_NAME_LENGTH}
          validate={(name) => sourceNameSchema.safeParse(name).success}
          invalidMessage={t('sidebar.invalidSourceName')}
          onSubmit={handleSourceNameSubmit}
          onCancel={() => setRenamingSource(null)}
        />
      )}

      {actionFailed && <ErrorDialog onClose={() => setActionFailed(false)} />}

      {pendingMove && (
        <MoveConfirmDialog
          itemName={pendingMove.kind === 'source' ? sourceDisplayName(pendingMove.source) : pendingMove.folder.name}
          targetName={pendingMove.targetName}
          onCancel={() => setPendingMove(null)}
          onConfirm={() => void confirmPendingMove()}
        />
      )}

      {pendingDelete && (
        <DeleteFolderDialog
          folderName={pendingDelete.folder.name}
          subfolderCount={pendingDelete.subfolderCount}
          sourceCount={pendingDelete.sourceCount}
          onCancel={() => setPendingDelete(null)}
          onConfirm={() => void confirmDeleteFolder()}
        />
      )}

      {pendingDeleteSource && (
        <DeleteSourceDialog
          sourceName={sourceDisplayName(pendingDeleteSource)}
          onCancel={() => setPendingDeleteSource(null)}
          onConfirm={() => void confirmDeleteSource()}
        />
      )}
    </>
  );
}
