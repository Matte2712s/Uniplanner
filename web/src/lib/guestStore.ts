import type { Lang, ProgramDto, SourceDto, View, ViewSettings } from '@planner/shared';
import { collectSubtreeIds, defaultViewSettings, isSelfOrDescendant } from '@planner/shared';

const KEY = 'planner.guest.v1';
const IMPORTED_KEY = 'planner.guest.imported';

export interface GuestFolder {
  id: number;
  name: string;
  position: number;
  parentId: number | null;
}

interface GuestState {
  views: View[];
  activeViewId: number | null;
  lang: Lang;
  nextId: number;
  customSources: SourceDto[];
  folders: GuestFolder[];
  nextFolderId: number;
  // sourceId -> folderId (null = not in any folder)
  placements: Record<number, number | null>;
  // ids of default sources this guest has added (via a program, individually)
  addedDefaultIds: number[];
  // sourceId -> per-user rename override
  customNames: Record<number, string>;
}

function read(): GuestState {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return seed();
    const parsed = JSON.parse(raw) as GuestState;
    if (!Array.isArray(parsed.views) || parsed.views.length === 0) return seed();
    return {
      ...parsed,
      customSources: parsed.customSources ?? [],
      folders: (parsed.folders ?? []).map((f) => ({ ...f, parentId: f.parentId ?? null })),
      nextFolderId: parsed.nextFolderId ?? 1,
      placements: parsed.placements ?? {},
      addedDefaultIds: parsed.addedDefaultIds ?? [],
      customNames: parsed.customNames ?? {},
    };
  } catch {
    return seed();
  }
}

function seed(): GuestState {
  const view: View = {
    id: 1,
    name: 'Il mio orario',
    position: 0,
    settings: defaultViewSettings(),
    updatedAt: new Date().toISOString(),
    shareToken: null,
  };
  return {
    views: [view],
    activeViewId: view.id,
    lang: 'it',
    nextId: 2,
    customSources: [],
    folders: [],
    nextFolderId: 1,
    placements: {},
    addedDefaultIds: [],
    customNames: {},
  };
}

function write(state: GuestState): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch {
    // localStorage unavailable (private mode, quota): guest state just
    // won't survive a reload, which is an acceptable degradation.
  }
}

export function hasGuestData(): boolean {
  try {
    return localStorage.getItem(KEY) !== null;
  } catch {
    return false;
  }
}

export function wasImportOffered(): boolean {
  try {
    return localStorage.getItem(IMPORTED_KEY) === 'true';
  } catch {
    return true;
  }
}

export function markImportHandled(): void {
  try {
    localStorage.setItem(IMPORTED_KEY, 'true');
  } catch {
    // ignore
  }
}

export function clearGuestData(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    // ignore
  }
}

/** Drops a source's course selections from every view that referenced it. */
function pruneSourceFromViews(views: View[], sourceId: number): View[] {
  return views.map((v) =>
    v.settings.sources.some((s) => s.sourceId === sourceId)
      ? { ...v, settings: { ...v.settings, sources: v.settings.sources.filter((s) => s.sourceId !== sourceId) } }
      : v,
  );
}

export const guestStore = {
  get(): GuestState {
    return read();
  },

  setLang(lang: Lang): void {
    write({ ...read(), lang });
  },

  setActiveViewId(id: number): void {
    write({ ...read(), activeViewId: id });
  },

  createView(name: string, settings: ViewSettings = defaultViewSettings()): View {
    const state = read();
    const view: View = {
      id: state.nextId,
      name,
      position: state.views.length,
      settings,
      updatedAt: new Date().toISOString(),
      shareToken: null,
    };
    write({ ...state, views: [...state.views, view], nextId: state.nextId + 1, activeViewId: view.id });
    return view;
  },

  updateView(id: number, patch: { name?: string; settings?: ViewSettings }): void {
    const state = read();
    write({
      ...state,
      views: state.views.map((v) =>
        v.id === id
          ? { ...v, name: patch.name ?? v.name, settings: patch.settings ?? v.settings, updatedAt: new Date().toISOString() }
          : v,
      ),
    });
  },

  deleteView(id: number): void {
    const state = read();
    const views = state.views.filter((v) => v.id !== id);
    const activeViewId = state.activeViewId === id ? (views[0]?.id ?? null) : state.activeViewId;
    write({ ...state, views: views.length > 0 ? views : seed().views, activeViewId });
  },

  reorder(order: number[]): void {
    const state = read();
    const byId = new Map(state.views.map((v) => [v.id, v]));
    const views = order.map((id, index) => {
      const v = byId.get(id);
      return v ? { ...v, position: index } : undefined;
    }).filter((v): v is View => Boolean(v));
    write({ ...state, views });
  },

  addCustomSource(source: SourceDto): void {
    const state = read();
    if (state.customSources.some((s) => s.id === source.id)) return;
    write({ ...state, customSources: [...state.customSources, source] });
  },

  /**
   * Removes a source of either kind: drops it from customSources/addedDefaultIds,
   * clears its placement and rename override, and forgets any course
   * selections it had in every view (so they don't linger or resurface if
   * the same source is re-added later).
   */
  removeSource(id: number): void {
    const state = read();
    const placements = { ...state.placements };
    delete placements[id];
    const customNames = { ...state.customNames };
    delete customNames[id];
    write({
      ...state,
      customSources: state.customSources.filter((s) => s.id !== id),
      addedDefaultIds: state.addedDefaultIds.filter((sid) => sid !== id),
      placements,
      customNames,
      views: pruneSourceFromViews(state.views, id),
    });
  },

  /** Sets a per-user display-name override for a source (default or custom). */
  renameSource(id: number, name: string): void {
    const state = read();
    write({ ...state, customNames: { ...state.customNames, [id]: name } });
  },

  createFolder(name: string, parentId: number | null = null): GuestFolder {
    const state = read();
    const siblingCount = state.folders.filter((f) => f.parentId === parentId).length;
    const folder: GuestFolder = { id: state.nextFolderId, name, position: siblingCount, parentId };
    write({ ...state, folders: [...state.folders, folder], nextFolderId: state.nextFolderId + 1 });
    return folder;
  },

  renameFolder(id: number, name: string): void {
    const state = read();
    write({ ...state, folders: state.folders.map((f) => (f.id === id ? { ...f, name } : f)) });
  },

  /** Rejects (no-ops) a move that would put a folder inside itself or one of its own descendants. */
  moveFolder(id: number, parentId: number | null): void {
    const state = read();
    if (parentId != null && isSelfOrDescendant(state.folders, id, parentId)) return;
    const siblingCount = state.folders.filter((f) => f.id !== id && f.parentId === parentId).length;
    write({
      ...state,
      folders: state.folders.map((f) => (f.id === id ? { ...f, parentId, position: siblingCount } : f)),
    });
  },

  /** Deletes a folder and its whole subtree, along with every source placed anywhere in it (like removing them one by one). */
  deleteFolder(id: number): void {
    const state = read();
    const removedIds = new Set([id, ...collectSubtreeIds(state.folders, id)]);
    const sourceIds = Object.entries(state.placements)
      .filter(([, folderId]) => folderId != null && removedIds.has(folderId))
      .map(([sourceId]) => Number(sourceId));
    const removedSourceIds = new Set(sourceIds);

    const placements = { ...state.placements };
    const customNames = { ...state.customNames };
    for (const sourceId of sourceIds) {
      delete placements[sourceId];
      delete customNames[sourceId];
    }
    let views = state.views;
    for (const sourceId of sourceIds) views = pruneSourceFromViews(views, sourceId);

    write({
      ...state,
      folders: state.folders.filter((f) => !removedIds.has(f.id)),
      customSources: state.customSources.filter((s) => !removedSourceIds.has(s.id)),
      addedDefaultIds: state.addedDefaultIds.filter((sid) => !removedSourceIds.has(sid)),
      placements,
      customNames,
      views,
    });
  },

  setPlacement(sourceId: number, folderId: number | null): void {
    const state = read();
    write({ ...state, placements: { ...state.placements, [sourceId]: folderId } });
  },

  /**
   * Adds every not-yet-added source of a program: marks it added and places
   * it into a "Corso di <program>" folder, walking each source's groupPath
   * into nested subfolders - reusing an existing same-named folder/subfolder
   * at each level rather than duplicating, exactly like the server's
   * addProgramForUser. Never touches a source already added.
   */
  addProgram(program: string, sources: { id: number; groupPath: string[] }[]): void {
    const state = read();
    const added = new Set(state.addedDefaultIds);
    const newSources = sources.filter((s) => !added.has(s.id));
    if (newSources.length === 0) return;

    const rootName = `Corso di ${program}`;
    let folders = state.folders;
    let root = folders.find((f) => f.parentId == null && f.name === rootName);
    let nextFolderId = state.nextFolderId;
    if (!root) {
      root = { id: nextFolderId++, name: rootName, position: folders.length, parentId: null };
      folders = [...folders, root];
    }
    const folderByParentAndName = new Map<string, GuestFolder>();
    for (const f of folders) folderByParentAndName.set(`${f.parentId}:${f.name}`, f);

    function resolveSubfolder(parent: GuestFolder, name: string): GuestFolder {
      const key = `${parent.id}:${name}`;
      let folder = folderByParentAndName.get(key);
      if (!folder) {
        const siblingCount = folders.filter((f) => f.parentId === parent.id).length;
        folder = { id: nextFolderId++, name, position: siblingCount, parentId: parent.id };
        folderByParentAndName.set(key, folder);
        folders = [...folders, folder];
      }
      return folder;
    }

    const placements = { ...state.placements };
    for (const source of newSources) {
      let target = root;
      for (const segment of source.groupPath) target = resolveSubfolder(target, segment);
      placements[source.id] = target.id;
      added.add(source.id);
    }
    write({ ...state, folders, nextFolderId, placements, addedDefaultIds: [...added] });
  },

  /** Filters the full default-source catalog down to what this guest has added, merging in each one's folder and rename override. */
  resolveDefaults(catalog: SourceDto[]): SourceDto[] {
    const state = read();
    const added = new Set(state.addedDefaultIds);
    return catalog
      .filter((s) => added.has(s.id))
      .map((s) => ({ ...s, folderId: state.placements[s.id] ?? null, displayName: state.customNames[s.id] ?? null }));
  },

  /** Recomputes each program's `added` state from what this guest has actually added locally. */
  resolvePrograms(programs: ProgramDto[]): ProgramDto[] {
    const added = new Set(read().addedDefaultIds);
    return programs.map((p) => ({ ...p, added: p.sources.every((s) => added.has(s.id)) }));
  },
};
