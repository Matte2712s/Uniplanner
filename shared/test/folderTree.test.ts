import { describe, expect, it } from 'vitest';
import { buildFolderTree, collectSubtreeIds, isSelfOrDescendant, type FolderNode } from '../src/folderTree.ts';

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
