import { useDraggable, useDroppable } from '@dnd-kit/core';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { FolderDto, SourceDto, ViewSettings } from '@planner/shared';
import type { FolderTreeNode } from '@planner/shared';
import { SourceBlock } from './SourceBlock.tsx';
import { IconFolder, IconGripVertical, IconPencil, IconPlus, IconTrash } from './icons.tsx';

export interface FolderTreeCallbacks {
  settings: ViewSettings;
  onChange: (settings: ViewSettings) => void;
  onRemoveSource: (source: SourceDto) => void;
  onRenameSource: (source: SourceDto) => void;
  onRename: (folderId: number, currentName: string) => void;
  onNewSubfolder: (parentId: number) => void;
  onDeleteRequest: (folder: FolderDto) => void;
}

function FolderNodeItem({
  node,
  sourcesByFolder,
  expandedByDefault,
  ...callbacks
}: FolderTreeCallbacks & {
  node: FolderTreeNode<FolderDto>;
  sourcesByFolder: Map<number, SourceDto[]>;
  expandedByDefault: Set<number>;
}) {
  const { t } = useTranslation();
  const { folder, children } = node;
  const [open, setOpen] = useState(expandedByDefault.has(folder.id));

  const { attributes, listeners, setNodeRef: setDragRef, isDragging } = useDraggable({
    id: `folder-${folder.id}`,
    data: { kind: 'folder', folder },
  });
  const { setNodeRef: setDropRef, isOver } = useDroppable({ id: `folder-drop-${folder.id}` });

  const items = sourcesByFolder.get(folder.id) ?? [];

  return (
    <div className="source-folder" style={{ opacity: isDragging ? 0.4 : 1 }}>
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
          <button className="icon-btn icon-btn-sm" title={t('folders.rename')} onClick={() => callbacks.onRename(folder.id, folder.name)}>
            <IconPencil />
          </button>
          <button className="icon-btn icon-btn-sm" title={t('folders.delete')} onClick={() => callbacks.onDeleteRequest(folder)}>
            <IconTrash />
          </button>
        </div>
      </div>
      {open && (
        <div className="source-folder-body">
          {items.map((s) => (
            <SourceBlock
              key={s.id}
              source={s}
              settings={callbacks.settings}
              onChange={callbacks.onChange}
              onRemove={() => callbacks.onRemoveSource(s)}
              onRename={() => callbacks.onRenameSource(s)}
            />
          ))}
          {children.map((child) => (
            <FolderNodeItem key={child.folder.id} node={child} sourcesByFolder={sourcesByFolder} expandedByDefault={expandedByDefault} {...callbacks} />
          ))}
        </div>
      )}
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
      {nodes.map((node) => (
        <FolderNodeItem key={node.folder.id} node={node} sourcesByFolder={sourcesByFolder} expandedByDefault={expandedByDefault} {...callbacks} />
      ))}
    </>
  );
}
