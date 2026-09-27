import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { createContext, useContext, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { FolderDto, Lang, MeDto, ProgramDto, SourceDto, View, ViewSettings } from '@planner/shared';
import { defaultViewSettings, MAX_FOLDERS_PER_USER, MAX_VIEWS_PER_USER } from '@planner/shared';
import { api } from '../api/client.ts';
import { clearGuestData, guestStore, hasGuestData, markImportHandled, wasImportOffered } from '../lib/guestStore.ts';

interface PlannerState {
  user: MeDto | null;
  authLoading: boolean;
  login(): void;
  logout(): Promise<void>;

  lang: Lang;
  setLang(lang: Lang): void;

  sources: { defaults: SourceDto[]; custom: SourceDto[] };
  sourcesLoading: boolean;
  refetchSources(): void;
  addCustomSource(source: SourceDto): void;
  removeSource(id: number): Promise<void>;
  renameSource(id: number, name: string): Promise<void>;
  setSourcePlacement(sourceId: number, folderId: number | null): Promise<void>;

  programs: ProgramDto[];
  addProgram(program: string): Promise<void>;

  folders: FolderDto[];
  foldersAtLimit: boolean;
  createFolder(name: string, parentId?: number | null): Promise<FolderDto>;
  renameFolder(id: number, name: string): Promise<void>;
  moveFolder(id: number, parentId: number | null): Promise<void>;
  deleteFolder(id: number): Promise<void>;

  views: View[];
  activeView: View | null;
  activeViewId: number | null;
  setActiveViewId(id: number): void;
  createView(name: string, settings?: ViewSettings): Promise<void>;
  renameView(id: number, name: string): Promise<void>;
  updateActiveViewSettings(settings: ViewSettings): Promise<void>;
  duplicateView(id: number): Promise<void>;
  deleteView(id: number): Promise<void>;
  reorderViews(order: number[]): Promise<void>;
  viewsAtLimit: boolean;
  shareView(id: number): Promise<void>;
  unshareView(id: number): Promise<void>;

  pendingImport: { count: number } | null;
  confirmImport(): Promise<void>;
  skipImport(): void;
}

const Ctx = createContext<PlannerState | null>(null);

export function usePlanner(): PlannerState {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('usePlanner must be used within PlannerProvider');
  return ctx;
}

export function PlannerProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const { i18n, t } = useTranslation();

  const meQuery = useQuery({ queryKey: ['me'], queryFn: api.me, staleTime: 60_000 });
  const user = meQuery.data ?? null;
  const authed = Boolean(user);

  const sourcesQuery = useQuery({ queryKey: ['sources'], queryFn: api.sources });
  const serverQuery = useQuery({ queryKey: ['views'], queryFn: api.views, enabled: authed });
  const prefsQuery = useQuery({ queryKey: ['prefs'], queryFn: api.prefs, enabled: authed });

  // Guest state is plain localStorage, mirrored into React state so writes re-render.
  const [guest, setGuest] = useState(() => guestStore.get());
  const refreshGuest = () => setGuest(guestStore.get());

  const views = authed ? (serverQuery.data?.views ?? []) : guest.views;
  const activeViewId = authed ? (prefsQuery.data?.activeViewId ?? views[0]?.id ?? null) : guest.activeViewId;
  const activeView = views.find((v) => v.id === activeViewId) ?? views[0] ?? null;
  const lang: Lang = authed ? (prefsQuery.data?.lang ?? 'it') : guest.lang;

  useEffect(() => {
    if (i18n.language !== lang) void i18n.changeLanguage(lang);
  }, [lang, i18n]);

  // A brand-new account has zero views on the server, and nothing else
  // ever creates a first one. Right after login, decide once between two
  // mutually exclusive things: offer to import local guest views (if any
  // are waiting and haven't been offered before), or otherwise seed a
  // plain default view so the app never gets stuck with nothing to show.
  // Both live in one effect (not two separate ones) specifically so they
  // can't race each other and both create a view.
  const [pendingImport, setPendingImport] = useState<{ count: number } | null>(null);
  const bootstrapped = useRef(false);
  useEffect(() => {
    if (!authed || !serverQuery.isSuccess || bootstrapped.current) return;
    bootstrapped.current = true;
    if (serverQuery.data.views.length > 0) return;

    if (hasGuestData() && !wasImportOffered()) {
      const count = guestStore.get().views.length;
      if (count > 0) {
        setPendingImport({ count });
        return;
      }
    }
    void createViewMutation.mutateAsync({ name: 'Il mio orario', settings: defaultViewSettings() });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authed, serverQuery.isSuccess, serverQuery.data]);

  const setLangMutation = useMutation({
    mutationFn: async (next: Lang) => {
      if (authed) await api.setPrefs({ lang: next });
      else guestStore.setLang(next);
    },
    onSuccess: () => (authed ? qc.invalidateQueries({ queryKey: ['prefs'] }) : refreshGuest()),
  });

  const createViewMutation = useMutation({
    mutationFn: (input: { name: string; settings: ViewSettings }) => api.createView(input.name, input.settings),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['views'] }),
  });
  const updateViewMutation = useMutation({
    mutationFn: (input: { id: number; patch: { name?: string; settings?: ViewSettings } }) =>
      api.updateView(input.id, input.patch),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['views'] }),
  });
  const deleteViewMutation = useMutation({
    mutationFn: (id: number) => api.deleteView(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['views'] }),
  });
  const reorderViewsMutation = useMutation({
    mutationFn: (order: number[]) => api.reorderViews(order),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['views'] }),
  });
  const shareViewMutation = useMutation({
    mutationFn: (id: number) => api.shareView(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['views'] }),
  });
  const unshareViewMutation = useMutation({
    mutationFn: (id: number) => api.unshareView(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['views'] }),
  });
  const setActivePrefMutation = useMutation({
    mutationFn: (id: number) => api.setPrefs({ activeViewId: id }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['prefs'] }),
  });
  const removeSourceMutation = useMutation({
    mutationFn: (id: number) => api.removeSource(id),
    // Removing a source also prunes its course selections from every view server-side.
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['sources'] });
      qc.invalidateQueries({ queryKey: ['views'] });
    },
  });
  const renameSourceMutation = useMutation({
    mutationFn: (input: { id: number; name: string }) => api.renameSource(input.id, input.name),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['sources'] }),
  });
  const setPlacementMutation = useMutation({
    mutationFn: (input: { id: number; folderId: number | null }) => api.setSourcePlacement(input.id, input.folderId),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['sources'] }),
  });
  const addProgramMutation = useMutation({
    mutationFn: (program: string) => api.addProgram(program),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['sources'] }),
  });
  const createFolderMutation = useMutation({
    mutationFn: (name: string) => api.createFolder(name),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['sources'] }),
  });
  const renameFolderMutation = useMutation({
    mutationFn: (input: { id: number; name: string }) => api.renameFolder(input.id, input.name),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['sources'] }),
  });
  const moveFolderMutation = useMutation({
    mutationFn: (input: { id: number; parentId: number | null }) => api.moveFolder(input.id, input.parentId),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['sources'] }),
  });
  const deleteFolderMutation = useMutation({
    mutationFn: (id: number) => api.deleteFolder(id),
    // Deleting a folder also deletes the sources placed in it, which prunes their course selections from every view server-side.
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['sources'] });
      qc.invalidateQueries({ queryKey: ['views'] });
    },
  });
  const logoutMutation = useMutation({
    mutationFn: api.logout,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['me'] }),
  });

  const programs = authed ? (sourcesQuery.data?.programs ?? []) : guestStore.resolvePrograms(sourcesQuery.data?.programs ?? []);

  const value: PlannerState = {
    user,
    authLoading: meQuery.isLoading,
    login: () => {
      window.location.href = api.googleLoginUrl();
    },
    logout: async () => {
      await logoutMutation.mutateAsync();
    },

    lang,
    setLang: (next) => setLangMutation.mutate(next),

    sources: {
      defaults: authed
        ? (sourcesQuery.data?.defaults ?? [])
        : guestStore.resolveDefaults((sourcesQuery.data?.programs ?? []).flatMap((p) => p.sources)),
      custom: authed
        ? (sourcesQuery.data?.custom ?? [])
        : guest.customSources.map((s) => ({
            ...s,
            folderId: guest.placements[s.id] ?? null,
            displayName: guest.customNames[s.id] ?? null,
          })),
    },
    sourcesLoading: sourcesQuery.isLoading,
    refetchSources: () => qc.invalidateQueries({ queryKey: ['sources'] }),
    addCustomSource: (source) => {
      if (!authed) {
        guestStore.addCustomSource(source);
        refreshGuest();
      }
      qc.invalidateQueries({ queryKey: ['sources'] });
    },
    removeSource: async (id) => {
      if (authed) {
        try {
          await removeSourceMutation.mutateAsync(id);
        } catch {
          window.alert(t('error.generic'));
        }
      } else {
        guestStore.removeSource(id);
        refreshGuest();
      }
    },
    renameSource: async (id, name) => {
      if (authed) {
        try {
          await renameSourceMutation.mutateAsync({ id, name });
        } catch {
          window.alert(t('error.generic'));
        }
      } else {
        guestStore.renameSource(id, name);
        refreshGuest();
      }
    },
    setSourcePlacement: async (sourceId, folderId) => {
      if (authed) {
        await setPlacementMutation.mutateAsync({ id: sourceId, folderId });
      } else {
        guestStore.setPlacement(sourceId, folderId);
        refreshGuest();
      }
    },

    programs,
    addProgram: async (program) => {
      if (authed) {
        await addProgramMutation.mutateAsync(program);
      } else {
        const entry = (sourcesQuery.data?.programs ?? []).find((p) => p.program === program);
        if (entry) guestStore.addProgram(program, entry.sources.map((s) => ({ id: s.id, groupPath: s.groupPath })));
        refreshGuest();
      }
    },

    folders: authed ? (sourcesQuery.data?.folders ?? []) : guest.folders,
    foldersAtLimit: (authed ? (sourcesQuery.data?.folders?.length ?? 0) : guest.folders.length) >= MAX_FOLDERS_PER_USER,
    createFolder: async (name, parentId = null) => {
      if (authed) {
        const result = await createFolderMutation.mutateAsync(name);
        if (parentId != null) {
          const moved = await moveFolderMutation.mutateAsync({ id: result.folder.id, parentId });
          return moved.folder;
        }
        return result.folder;
      }
      const folder = guestStore.createFolder(name, parentId);
      refreshGuest();
      return folder;
    },
    renameFolder: async (id, name) => {
      if (authed) {
        await renameFolderMutation.mutateAsync({ id, name });
      } else {
        guestStore.renameFolder(id, name);
        refreshGuest();
      }
    },
    moveFolder: async (id, parentId) => {
      if (authed) {
        await moveFolderMutation.mutateAsync({ id, parentId });
      } else {
        guestStore.moveFolder(id, parentId);
        refreshGuest();
      }
    },
    deleteFolder: async (id) => {
      if (authed) {
        try {
          await deleteFolderMutation.mutateAsync(id);
        } catch {
          window.alert(t('error.generic'));
        }
      } else {
        guestStore.deleteFolder(id);
        refreshGuest();
      }
    },

    views,
    activeView,
    activeViewId,
    setActiveViewId: (id) => {
      if (authed) setActivePrefMutation.mutate(id);
      else {
        guestStore.setActiveViewId(id);
        refreshGuest();
      }
    },
    createView: async (name, settings = defaultViewSettings()) => {
      if (authed) await createViewMutation.mutateAsync({ name, settings });
      else {
        guestStore.createView(name, settings);
        refreshGuest();
      }
    },
    renameView: async (id, name) => {
      if (authed) await updateViewMutation.mutateAsync({ id, patch: { name } });
      else {
        guestStore.updateView(id, { name });
        refreshGuest();
      }
    },
    updateActiveViewSettings: async (settings) => {
      if (!activeView) return;
      if (authed) await updateViewMutation.mutateAsync({ id: activeView.id, patch: { settings } });
      else {
        guestStore.updateView(activeView.id, { settings });
        refreshGuest();
      }
    },
    duplicateView: async (id) => {
      const source = views.find((v) => v.id === id);
      if (!source) return;
      const name = `${source.name} (2)`;
      if (authed) await createViewMutation.mutateAsync({ name, settings: source.settings });
      else {
        guestStore.createView(name, source.settings);
        refreshGuest();
      }
    },
    deleteView: async (id) => {
      if (authed) await deleteViewMutation.mutateAsync(id);
      else {
        guestStore.deleteView(id);
        refreshGuest();
      }
    },
    reorderViews: async (order) => {
      if (authed) await reorderViewsMutation.mutateAsync(order);
      else {
        guestStore.reorder(order);
        refreshGuest();
      }
    },
    viewsAtLimit: authed ? views.length >= MAX_VIEWS_PER_USER : false,
    // Guest views only live in this browser's local storage, so there's no
    // server-side row a share token could point at - sharing requires an account.
    shareView: async (id) => {
      if (!authed) return;
      await shareViewMutation.mutateAsync(id);
    },
    unshareView: async (id) => {
      if (!authed) return;
      await unshareViewMutation.mutateAsync(id);
    },

    pendingImport,
    confirmImport: async () => {
      const local = guestStore.get().views;
      for (const v of local) {
        // Sequential on purpose: preserves the guest views' relative order.
        await createViewMutation.mutateAsync({ name: v.name, settings: v.settings });
      }
      clearGuestData();
      markImportHandled();
      setPendingImport(null);
    },
    skipImport: () => {
      markImportHandled();
      setPendingImport(null);
      // Declining still leaves a brand-new account with zero views otherwise.
      if (views.length === 0) {
        void createViewMutation.mutateAsync({ name: 'Il mio orario', settings: defaultViewSettings() });
      }
    },
  };

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
