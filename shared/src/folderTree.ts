export interface FolderNode {
  id: number;
  name: string;
  position: number;
  parentId: number | null;
}

/** True if candidateId is folderId itself, or sits anywhere under it. Used to reject a reparent that would create a cycle. */
export function isSelfOrDescendant(folders: FolderNode[], folderId: number, candidateId: number): boolean {
  if (candidateId === folderId) return true;
  let current = folders.find((f) => f.id === candidateId);
  while (current?.parentId != null) {
    if (current.parentId === folderId) return true;
    current = folders.find((f) => f.id === current!.parentId);
  }
  return false;
}

/** Every folder id anywhere under rootId (not including rootId itself). */
export function collectSubtreeIds(folders: FolderNode[], rootId: number): number[] {
  const result: number[] = [];
  const queue = [rootId];
  while (queue.length > 0) {
    const parentId = queue.shift()!;
    for (const f of folders) {
      if (f.parentId === parentId) {
        result.push(f.id);
        queue.push(f.id);
      }
    }
  }
  return result;
}

export type SiblingKind = 'folder' | 'source';

export interface SiblingRef {
  kind: SiblingKind;
  id: number;
}

export interface Sibling extends SiblingRef {
  position: number;
}

/** A source's placement, enough to order it among its folder's children. */
export interface PlacedSource {
  id: number;
  folderId: number | null;
  position: number;
}

export function isSameSibling(a: SiblingRef, b: SiblingRef): boolean {
  return a.kind === b.kind && a.id === b.id;
}

/** Display order: by position; on a tie sources come first (the layout from before sources had a position), then by id. */
export function sortSiblings<T extends Sibling>(items: T[]): T[] {
  return [...items].sort((a, b) => a.position - b.position || (a.kind === b.kind ? a.id - b.id : a.kind === 'source' ? -1 : 1));
}

/**
 * Everything directly inside parentId, subfolders and placed sources together,
 * in display order. The root (null) lists folders only: root-level sources sit
 * in their own list below the tree and take no part in the ordering.
 */
export function childrenOf(folders: FolderNode[], sources: PlacedSource[], parentId: number | null): Sibling[] {
  const children: Sibling[] = folders
    .filter((f) => f.parentId === parentId)
    .map((f) => ({ kind: 'folder', id: f.id, position: f.position }));
  if (parentId != null) {
    for (const s of sources) if (s.folderId === parentId) children.push({ kind: 'source', id: s.id, position: s.position });
  }
  return sortSiblings(children);
}

/**
 * Child order of parentId once `moved` is there. The index counts the other
 * children only (`moved` itself not counted); omitted or past the end appends.
 */
export function siblingOrderAfterMove(
  folders: FolderNode[],
  sources: PlacedSource[],
  moved: SiblingRef,
  parentId: number | null,
  index?: number,
): SiblingRef[] {
  const order: SiblingRef[] = childrenOf(folders, sources, parentId)
    .filter((c) => !isSameSibling(c, moved))
    .map(({ kind, id }) => ({ kind, id }));
  order.splice(index === undefined ? order.length : Math.max(0, Math.min(index, order.length)), 0, { kind: moved.kind, id: moved.id });
  return order;
}

/** Index to hand to siblingOrderAfterMove so `moved` lands just before or after `neighbor` among parentId's other children. */
export function slotIndex(
  folders: FolderNode[],
  sources: PlacedSource[],
  moved: SiblingRef,
  neighbor: SiblingRef,
  parentId: number | null,
  edge: 'before' | 'after',
): number {
  const at = childrenOf(folders, sources, parentId)
    .filter((c) => !isSameSibling(c, moved))
    .findIndex((c) => isSameSibling(c, neighbor));
  return edge === 'before' ? at : at + 1;
}

export interface FolderTreeNode<T extends FolderNode> {
  folder: T;
  children: FolderTreeNode<T>[];
}

/** Nests a flat, unordered folder list by parentId, sorting siblings by position at every level. */
export function buildFolderTree<T extends FolderNode>(folders: T[]): FolderTreeNode<T>[] {
  const byParent = new Map<number | null, T[]>();
  for (const f of folders) {
    const list = byParent.get(f.parentId);
    if (list) list.push(f);
    else byParent.set(f.parentId, [f]);
  }
  for (const list of byParent.values()) list.sort((a, b) => a.position - b.position);

  function build(parentId: number | null): FolderTreeNode<T>[] {
    return (byParent.get(parentId) ?? []).map((folder) => ({ folder, children: build(folder.id) }));
  }
  return build(null);
}
