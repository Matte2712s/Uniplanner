import { DndContext, DragOverlay, PointerSensor, useDroppable, useSensor, useSensors } from '@dnd-kit/core';
import type { DragEndEvent, DragStartEvent } from '@dnd-kit/core';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { FolderDto, SourceDto, ViewSettings } from '@planner/shared';
import { buildFolderTree, collectSubtreeIds, folderNameSchema, isSelfOrDescendant, sourceNameSchema } from '@planner/shared';
import { usePlanner } from '../state/PlannerContext.tsx';
import { AddSourceDialog } from './AddSourceDialog.tsx';
import { DeleteFolderDialog } from './DeleteFolderDialog.tsx';
import { DeleteSourceDialog } from './DeleteSourceDialog.tsx';
import { FolderTree } from './FolderTree.tsx';
import { IconFolder } from './icons.tsx';
import { MoveConfirmDialog } from './MoveConfirmDialog.tsx';
import { SourceBlock } from './SourceBlock.tsx';

type DragData = { kind: 'source'; source: SourceDto } | { kind: 'folder'; folder: FolderDto };

type PendingMove =
  | { kind: 'source'; source: SourceDto; targetFolderId: number | null; targetName: string | null }
  | { kind: 'folder'; folder: FolderDto; targetFolderId: number | null; targetName: string | null };

interface PendingDelete {
  folder: FolderDto;
  subfolderCount: number;
  sourceCount: number;
}

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

  function handleDragEnd(event: DragEndEvent) {
    setDragging(null);
    const over = event.over;
    const data = event.active.data.current as DragData | undefined;
    if (!over || !data) return;

    const overId = String(over.id);
    const targetFolderId = overId === 'root-drop' ? null : overId.startsWith('folder-drop-') ? Number(overId.slice('folder-drop-'.length)) : undefined;
    if (targetFolderId === undefined) return;
    const targetFolder = targetFolderId != null ? planner.folders.find((f) => f.id === targetFolderId) : undefined;
    if (targetFolderId != null && !targetFolder) return;
    if (data.kind === 'folder' && targetFolderId != null && isSelfOrDescendant(planner.folders, data.folder.id, targetFolderId)) return;

    requestMove({ ...data, targetFolderId, targetName: targetFolder?.name ?? null });
  }

  async function confirmPendingMove() {
    if (!pendingMove) return;
    if (pendingMove.kind === 'source') await planner.setSourcePlacement(pendingMove.source.id, pendingMove.targetFolderId);
    else await planner.moveFolder(pendingMove.folder.id, pendingMove.targetFolderId);
    setPendingMove(null);
  }

  function handleRename(folderId: number, currentName: string) {
    const input = window.prompt(t('folders.namePlaceholder'), currentName);
    if (input == null) return;
    const parsed = folderNameSchema.safeParse(input);
    if (!parsed.success) return window.alert(t('folders.invalidName'));
    if (parsed.data !== currentName) void planner.renameFolder(folderId, parsed.data);
  }

  function handleNewFolder(parentId: number | null) {
    if (planner.foldersAtLimit) return window.alert(t('folders.limitReached'));
    const placeholder = parentId != null ? t('folders.subfolderNamePlaceholder') : t('folders.namePlaceholder');
    const input = window.prompt(placeholder);
    if (input == null) return;
    const parsed = folderNameSchema.safeParse(input);
    if (!parsed.success) return window.alert(t('folders.invalidName'));
    void planner.createFolder(parsed.data, parentId);
  }

  function requestRenameSource(source: SourceDto) {
    const currentName = sourceDisplayName(source);
    const input = window.prompt(t('sidebar.renameSourcePlaceholder'), currentName);
    if (input == null) return;
    const parsed = sourceNameSchema.safeParse(input);
    if (!parsed.success) return window.alert(t('sidebar.invalidSourceName'));
    if (parsed.data !== currentName) void planner.renameSource(source.id, parsed.data);
  }

  function requestDeleteSource(source: SourceDto) {
    setPendingDeleteSource(source);
  }

  async function confirmDeleteSource() {
    if (!pendingDeleteSource) return;
    await planner.removeSource(pendingDeleteSource.id);
    setPendingDeleteSource(null);
  }

  function requestDeleteFolder(folder: FolderDto) {
    const subtreeIds = collectSubtreeIds(planner.folders, folder.id);
    const affected = new Set([folder.id, ...subtreeIds]);
    const sourceCount = all.filter((s) => s.folderId != null && affected.has(s.folderId)).length;
    if (subtreeIds.length === 0 && sourceCount === 0) {
      void planner.deleteFolder(folder.id);
      return;
    }
    setPendingDelete({ folder, subfolderCount: subtreeIds.length, sourceCount });
  }

  async function confirmDeleteFolder() {
    if (!pendingDelete) return;
    await planner.deleteFolder(pendingDelete.folder.id);
    setPendingDelete(null);
  }

  return (
    <>
      <div className="sidebar-scroll">
        <div className="section-title">{t('sidebar.sources')}</div>

        <DndContext sensors={sensors} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
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
