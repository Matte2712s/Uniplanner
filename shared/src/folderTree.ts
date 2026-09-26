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
