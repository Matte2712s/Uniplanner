import { useDndContext, useDraggable, useDroppable } from '@dnd-kit/core';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { FolderDto, Sibling, SiblingKind, SiblingRef, SourceDto, ViewSettings } from '@planner/shared';
import type { FolderTreeNode } from '@planner/shared';
import { sortSiblings } from '@planner/shared';
import { FolderSearch } from './FolderSearch.tsx';
import { SourceBlock } from './SourceBlock.tsx';
import { IconFolder, IconGripVertical, IconPencil, IconPlus, IconSearch, IconTrash } from './icons.tsx';

export interface FolderTreeCallbacks {
  settings: ViewSettings;
  onChange: (settings: ViewSettings) => void;
  onRemoveSource: (source: SourceDto) => void;
  onRenameSource: (source: SourceDto) => void;
  onRename: (folderId: number, currentName: string) => void;
  onNewSubfolder: (parentId: number) => void;
  onDeleteRequest: (folder: FolderDto) => void;
}

export type SlotEdge = 'before' | 'after';

// Drop slot id: insert the dragged item next to this folder or source instead of into it
export function siblingSlotId(edge: SlotEdge, neighbor: SiblingRef): string {
  return `slot-${edge}-${neighbor.kind}-${neighbor.id}`;
}

export function parseSiblingSlotId(id: string): { edge: SlotEdge; neighbor: SiblingRef } | null {
  const match = /^slot-(before|after)-(folder|source)-(\d+)$/.exec(id);
  return match ? { edge: match[1] as SlotEdge, neighbor: { kind: match[2] as SiblingKind, id: Number(match[3]) } } : null;
}

// All sources in a folder and its subfolders
function collectSources(node: FolderTreeNode<FolderDto>, sourcesByFolder: Map<number, SourceDto[]>): SourceDto[] {
  return [...(sourcesByFolder.get(node.folder.id) ?? []), ...node.children.flatMap((c) => collectSources(c, sourcesByFolder))];
}

function SiblingDropSlot({ edge, neighbor }: { edge: SlotEdge; neighbor: SiblingRef }) {
  const { setNodeRef, isOver } = useDroppable({ id: siblingSlotId(edge, neighbor) });
  return <div ref={setNodeRef} className={`sibling-drop-slot ${edge}${isOver ? ' drop-target' : ''}`} />;
}

type BodyEntry =
  | (Sibling & { kind: 'source'; source: SourceDto })
  | (Sibling & { kind: 'folder'; node: FolderTreeNode<FolderDto> });

// A source inside a folder, with drop slots so something can be placed before or after it
function SourceItem({
  source,
  isLast,
  inDragged,
  ...callbacks
}: FolderTreeCallbacks & {
  source: SourceDto;
  // Last among its siblings, so it also offers a slot after itself
  isLast: boolean;
  // Inside the folder being dragged
  inDragged: boolean;
}) {
  const { active } = useDndContext();
  const showSlots = active != null && !inDragged && active.id !== `source-${source.id}`;
  const self: SiblingRef = { kind: 'source', id: source.id };

  return (
    <div className="sibling-host">
      {showSlots && <SiblingDropSlot edge="before" neighbor={self} />}
      <SourceBlock
        source={source}
        settings={callbacks.settings}
        onChange={callbacks.onChange}
        onRemove={() => callbacks.onRemoveSource(source)}
        onRename={() => callbacks.onRenameSource(source)}
      />
      {showSlots && isLast && <SiblingDropSlot edge="after" neighbor={self} />}
    </div>
  );
}

function FolderNodeItem({
  node,
  sourcesByFolder,
  expandedByDefault,
  isLast,
  inDragged = false,
  ...callbacks
}: FolderTreeCallbacks & {
  node: FolderTreeNode<FolderDto>;
  sourcesByFolder: Map<number, SourceDto[]>;
  expandedByDefault: Set<number>;
  // Last among its siblings, so it also offers a slot after itself
  isLast: boolean;
  // Inside the folder being dragged
  inDragged?: boolean;
}) {
  const { t } = useTranslation();
  const { folder, children } = node;
  const [open, setOpen] = useState(expandedByDefault.has(folder.id));

  const { active } = useDndContext();
  const { attributes, listeners, setNodeRef: setDragRef, isDragging } = useDraggable({
    id: `folder-${folder.id}`,
    data: { kind: 'folder', folder },
  });
  const { setNodeRef: setDropRef, isOver } = useDroppable({ id: `folder-drop-${folder.id}` });

  // Nothing can be placed beside itself, and a folder can't go inside its own subtree
  const hideSlots = inDragged || isDragging;
  // Sources never sit at the root, so a dragged source gets no slots beside root folders
  const showSlots = active != null && !hideSlots && !(active.data.current?.kind === 'source' && folder.parentId == null);

  const items = sourcesByFolder.get(folder.id) ?? [];
  // Sources and subfolders share one order
  const entries = sortSiblings<BodyEntry>([
    ...items.map((source): BodyEntry => ({ kind: 'source', id: source.id, position: source.position, source })),
    ...children.map((child): BodyEntry => ({ kind: 'folder', id: child.folder.id, position: child.folder.position, node: child })),
  ]);
  const [searching, setSearching] = useState(false);

  return (
    <div className="source-folder" style={{ opacity: isDragging ? 0.4 : 1 }}>
      {showSlots && <SiblingDropSlot edge="before" neighbor={{ kind: 'folder', id: folder.id }} />}
      <div ref={setDropRef} className={`source-folder-header${isOver ? ' drop-target' : ''}`}>
        <button className="drag-handle" ref={setDragRef} {...attributes} {...listeners} aria-label={t('sidebar.dragHandle')}>
          <IconGripVertical />
        </button>
        <button className="folder-caret-btn" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
          <span className="folder-caret">{open ? '▾' : '▸'}</span>
        </button>
        <IconFolder className="folder-row-icon" />
        <span className="name">{folder.name}</span>
        <span className="hint">{items.length + children.length}</span>
        <div className="source-folder-actions">
          <button className="icon-btn icon-btn-sm" title={t('folders.newSubfolder')} onClick={() => callbacks.onNewSubfolder(folder.id)}>
            <IconPlus />
          </button>
          <button
            className={`icon-btn icon-btn-sm${searching ? ' active' : ''}`}
            title={t('folders.search')}
            aria-pressed={searching}
            onClick={() => setSearching((v) => !v)}
          >
            <IconSearch />
          </button>
          <button className="icon-btn icon-btn-sm" title={t('folders.rename')} onClick={() => callbacks.onRename(folder.id, folder.name)}>
            <IconPencil />
          </button>
          <button className="icon-btn icon-btn-sm" title={t('folders.delete')} onClick={() => callbacks.onDeleteRequest(folder)}>
            <IconTrash />
          </button>
        </div>
      </div>
      {searching && <FolderSearch sources={collectSources(node, sourcesByFolder)} settings={callbacks.settings} onChange={callbacks.onChange} />}
      {open && (
        <div className="source-folder-body">
          {entries.map((entry, i) =>
            entry.kind === 'source' ? (
              <SourceItem key={`source-${entry.id}`} source={entry.source} isLast={i === entries.length - 1} inDragged={hideSlots} {...callbacks} />
            ) : (
              <FolderNodeItem
                key={`folder-${entry.id}`}
                node={entry.node}
                sourcesByFolder={sourcesByFolder}
                expandedByDefault={expandedByDefault}
                isLast={i === entries.length - 1}
                inDragged={hideSlots}
                {...callbacks}
              />
            ),
          )}
        </div>
      )}
      {showSlots && isLast && <SiblingDropSlot edge="after" neighbor={{ kind: 'folder', id: folder.id }} />}
    </div>
  );
}

export function FolderTree({
  nodes,
  sourcesByFolder,
  expandedByDefault,
  ...callbacks
}: FolderTreeCallbacks & {
  nodes: FolderTreeNode<FolderDto>[];
  sourcesByFolder: Map<number, SourceDto[]>;
  expandedByDefault: Set<number>;
}) {
  return (
    <>
      {nodes.map((node, i) => (
        <FolderNodeItem
          key={node.folder.id}
          node={node}
          sourcesByFolder={sourcesByFolder}
          expandedByDefault={expandedByDefault}
          isLast={i === nodes.length - 1}
          {...callbacks}
        />
      ))}
    </>
  );
}
