import { describe, expect, it } from 'vitest';
import {
  buildFolderTree,
  childrenOf,
  collectSubtreeIds,
  isSelfOrDescendant,
  siblingOrderAfterMove,
  slotIndex,
  sortSiblings,
  type FolderNode,
  type PlacedSource,
} from '../src/folderTree.ts';

// 1 (root)
// \_ 2
//    \_ 3
// 4 (root, unrelated)
const CHAIN: FolderNode[] = [
  { id: 1, name: 'Root', position: 0, parentId: null },
  { id: 2, name: 'Child', position: 0, parentId: 1 },
  { id: 3, name: 'Grandchild', position: 0, parentId: 2 },
  { id: 4, name: 'Unrelated', position: 1, parentId: null },
];

describe('isSelfOrDescendant', () => {
  it('rejects reparenting a folder under itself', () => {
    expect(isSelfOrDescendant(CHAIN, 2, 2)).toBe(true);
  });

  it('rejects reparenting a folder under its own child', () => {
    expect(isSelfOrDescendant(CHAIN, 1, 2)).toBe(true);
  });

  it('rejects reparenting a folder under its own grandchild', () => {
    expect(isSelfOrDescendant(CHAIN, 1, 3)).toBe(true);
  });

  it('accepts reparenting under an unrelated folder', () => {
    expect(isSelfOrDescendant(CHAIN, 2, 4)).toBe(false);
  });

  it('accepts reparenting a child under an unrelated root (not its own ancestor chain)', () => {
    expect(isSelfOrDescendant(CHAIN, 3, 4)).toBe(false);
  });
});

describe('collectSubtreeIds', () => {
  it('returns every descendant at every depth', () => {
    expect(collectSubtreeIds(CHAIN, 1).sort()).toEqual([2, 3]);
  });

  it('returns nothing for a leaf', () => {
    expect(collectSubtreeIds(CHAIN, 3)).toEqual([]);
  });

  it('returns nothing for an unrelated root', () => {
    expect(collectSubtreeIds(CHAIN, 4)).toEqual([]);
  });
});

describe('buildFolderTree', () => {
  it('nests by parentId and orders siblings by position', () => {
    const unordered: FolderNode[] = [
      { id: 10, name: 'B', position: 1, parentId: null },
      { id: 11, name: 'A', position: 0, parentId: null },
      { id: 12, name: 'A-child', position: 0, parentId: 11 },
    ];
    const tree = buildFolderTree(unordered);
    expect(tree.map((n) => n.folder.name)).toEqual(['A', 'B']);
    expect(tree[0]!.children.map((n) => n.folder.name)).toEqual(['A-child']);
    expect(tree[1]!.children).toEqual([]);
  });
});

// Roots A(1) B(2) C(3) in that order, plus a child of A
const SIBLINGS: FolderNode[] = [
  { id: 3, name: 'C', position: 2, parentId: null },
  { id: 1, name: 'A', position: 0, parentId: null },
  { id: 2, name: 'B', position: 1, parentId: null },
  { id: 4, name: 'A-child', position: 0, parentId: 1 },
];

const folder = (id: number) => ({ kind: 'folder' as const, id });
const source = (id: number) => ({ kind: 'source' as const, id });

describe('sortSiblings', () => {
  it('orders by position', () => {
    const sorted = sortSiblings([
      { kind: 'folder', id: 1, position: 2 },
      { kind: 'source', id: 9, position: 0 },
      { kind: 'folder', id: 2, position: 1 },
    ]);
    expect(sorted.map((s) => s.id)).toEqual([9, 2, 1]);
  });

  it('puts sources before folders on a tie, then orders by id', () => {
    const sorted = sortSiblings([
      { kind: 'folder', id: 1, position: 0 },
      { kind: 'source', id: 8, position: 0 },
      { kind: 'source', id: 5, position: 0 },
      { kind: 'folder', id: 0, position: 0 },
    ]);
    expect(sorted.map((s) => `${s.kind}:${s.id}`)).toEqual(['source:5', 'source:8', 'folder:0', 'folder:1']);
  });
});

describe('childrenOf', () => {
  it('lists direct subfolders in position order', () => {
    expect(childrenOf(SIBLINGS, [], null).map((c) => c.id)).toEqual([1, 2, 3]);
    expect(childrenOf(SIBLINGS, [], 1).map((c) => c.id)).toEqual([4]);
  });

  it('interleaves the sources placed in a folder with its subfolders', () => {
    const sources: PlacedSource[] = [
      { id: 10, folderId: 1, position: 0 },
      { id: 11, folderId: 1, position: 1 },
      { id: 12, folderId: 2, position: 0 },
    ];
    const folders: FolderNode[] = [...SIBLINGS, { id: 5, name: 'A-child-2', position: 1, parentId: 1 }];
    // Position 0 is a tie between source 10 and folder 4: source first
    expect(childrenOf(folders, sources, 1).map((c) => `${c.kind}:${c.id}`)).toEqual(['source:10', 'folder:4', 'source:11', 'folder:5']);
  });

  it('ignores root-level sources', () => {
    const sources: PlacedSource[] = [{ id: 10, folderId: null, position: 0 }];
    expect(childrenOf(SIBLINGS, sources, null).map((c) => c.kind)).toEqual(['folder', 'folder', 'folder']);
  });
});

describe('siblingOrderAfterMove', () => {
  it('moves a folder up within its parent', () => {
    expect(siblingOrderAfterMove(SIBLINGS, [], folder(3), null, 0)).toEqual([folder(3), folder(1), folder(2)]);
  });

  it('moves a folder down within its parent, counting the other siblings only', () => {
    expect(siblingOrderAfterMove(SIBLINGS, [], folder(1), null, 2)).toEqual([folder(2), folder(3), folder(1)]);
  });

  it('appends when the index is omitted or past the end', () => {
    expect(siblingOrderAfterMove(SIBLINGS, [], folder(1), null)).toEqual([folder(2), folder(3), folder(1)]);
    expect(siblingOrderAfterMove(SIBLINGS, [], folder(1), null, 99)).toEqual([folder(2), folder(3), folder(1)]);
  });

  it('clamps a negative index to the start', () => {
    expect(siblingOrderAfterMove(SIBLINGS, [], folder(3), null, -5)).toEqual([folder(3), folder(1), folder(2)]);
  });

  it('inserts into a different parent', () => {
    expect(siblingOrderAfterMove(SIBLINGS, [], folder(2), 1, 0)).toEqual([folder(2), folder(4)]);
    expect(siblingOrderAfterMove(SIBLINGS, [], folder(2), 1, 1)).toEqual([folder(4), folder(2)]);
  });

  it('moves a source past a subfolder inside the same folder', () => {
    // Folder 1 holds source 10 (first, by the tie rule) then subfolder 4
    const sources: PlacedSource[] = [{ id: 10, folderId: 1, position: 0 }];
    expect(siblingOrderAfterMove(SIBLINGS, sources, source(10), 1, 1)).toEqual([folder(4), source(10)]);
  });

  it('puts a source from elsewhere between a folder children', () => {
    const sources: PlacedSource[] = [{ id: 10, folderId: 1, position: 0 }, { id: 20, folderId: null, position: 0 }];
    expect(siblingOrderAfterMove(SIBLINGS, sources, source(20), 1, 1)).toEqual([source(10), source(20), folder(4)]);
  });
});

describe('slotIndex', () => {
  const sources: PlacedSource[] = [{ id: 10, folderId: 1, position: 0 }];

  it('is the neighbor index for a slot before it and one past for a slot after it', () => {
    // Folder 1 children: source 10, folder 4; moving folder 2 in
    expect(slotIndex(SIBLINGS, sources, folder(2), source(10), 1, 'before')).toBe(0);
    expect(slotIndex(SIBLINGS, sources, folder(2), source(10), 1, 'after')).toBe(1);
    expect(slotIndex(SIBLINGS, sources, folder(2), folder(4), 1, 'after')).toBe(2);
  });

  it('does not count the moved item itself', () => {
    // Root order A B C; dropping A after C: the others are B C, so C sits at 1 and the slot is 2
    expect(slotIndex(SIBLINGS, [], folder(1), folder(3), null, 'after')).toBe(2);
    expect(slotIndex(SIBLINGS, [], folder(3), folder(1), null, 'before')).toBe(0);
  });
});
