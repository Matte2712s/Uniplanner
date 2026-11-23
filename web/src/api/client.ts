import type {
  AdminOverviewDto,
  CourseDto,
  CustomEventData,
  CustomEventDto,
  CustomEventsResponse,
  EventLabelDto,
  EventLabelInput,
  EventsResponse,
  FolderDto,
  GuestImportInput,
  Lang,
  MeDto,
  ProgramDto,
  SharedCustomEventsDto,
  SharedViewDto,
  SourceDto,
  View,
  ViewSettings,
  ViewSource,
} from '@planner/shared';

// What the timetable request needs: no custom events and no hidden-lesson rules
type CinecaSettings = Omit<ViewSettings, 'customEvents' | 'sources'> & { sources: Omit<ViewSource, 'hidden'>[] };

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    credentials: 'same-origin',
    // Fastify's JSON body parser rejects a request outright
    // (FST_ERR_CTP_EMPTY_JSON_BODY, a 400) if content-type says JSON but
    // the body is empty - which every no-body call here has (logout,
    // delete). Only claim a JSON body when we're actually sending one.
    headers: { ...(init?.body ? { 'content-type': 'application/json' } : {}), ...init?.headers },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new ApiError(res.status, body.error || `Request failed (${res.status})`);
  }
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

export const api = {
  me: () => call<MeDto | null>('/api/me'),
  logout: () => call<{ ok: true }>('/api/auth/logout', { method: 'POST' }),
  googleLoginUrl: () => '/api/auth/google',

  sources: () => call<{ defaults: SourceDto[]; custom: SourceDto[]; folders: FolderDto[]; programs: ProgramDto[] }>('/api/sources'),
  validateSource: (url: string) =>
    call<
      | { ok: true; host: string; title: string; titleEn: string | null; url: string }
      | { ok: false; error: { kind: string; reason?: string; message?: string } }
    >('/api/sources/validate', { method: 'POST', body: JSON.stringify({ url }) }),
  addSource: (url: string) =>
    call<{ ok: true; source: SourceDto } | { ok: false; error: unknown }>('/api/sources', {
      method: 'POST',
      body: JSON.stringify({ url }),
    }),
  removeSource: (id: number) => call<{ ok: true }>(`/api/sources/${id}`, { method: 'DELETE' }),
  setSourcePlacement: (id: number, folderId: number | null, index?: number) =>
    call<{ ok: true }>(`/api/sources/${id}/placement`, { method: 'PUT', body: JSON.stringify({ folderId, index }) }),
  renameSource: (id: number, name: string) =>
    call<{ ok: true }>(`/api/sources/${id}/name`, { method: 'PUT', body: JSON.stringify({ name }) }),
  sourceCourses: (id: number, from: string, to: string, refresh = false) =>
    call<{ courses: CourseDto[] }>(
      `/api/sources/${id}/courses?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}${refresh ? '&refresh=1' : ''}`,
    ),

  createFolder: (name: string) => call<{ folder: FolderDto }>('/api/folders', { method: 'POST', body: JSON.stringify({ name }) }),
  renameFolder: (id: number, name: string) =>
    call<{ folder: FolderDto }>(`/api/folders/${id}`, { method: 'PUT', body: JSON.stringify({ name }) }),
  moveFolder: (id: number, parentId: number | null, index?: number) =>
    call<{ folder: FolderDto }>(`/api/folders/${id}`, { method: 'PUT', body: JSON.stringify({ parentId, index }) }),
  deleteFolder: (id: number) => call<{ ok: true }>(`/api/folders/${id}`, { method: 'DELETE' }),

  addProgram: (program: string) =>
    call<{ ok: true; added: number }>(`/api/programs/${encodeURIComponent(program)}/add`, { method: 'POST' }),

  // Hiding is client side (ghosts need the hidden lessons), so callers leave the rules out
  previewEvents: (from: string, to: string, settings: CinecaSettings) =>
    call<EventsResponse>('/api/events/preview', { method: 'POST', body: JSON.stringify({ from, to, settings }) }),

  views: () => call<{ views: View[] }>('/api/views'),
  createView: (name: string, settings: ViewSettings) =>
    call<{ view: View }>('/api/views', { method: 'POST', body: JSON.stringify({ name, settings }) }),
  updateView: (id: number, patch: { name?: string; settings?: ViewSettings }) =>
    call<{ view: View }>(`/api/views/${id}`, { method: 'PUT', body: JSON.stringify(patch) }),
  deleteView: (id: number) => call<{ ok: true }>(`/api/views/${id}`, { method: 'DELETE' }),
  reorderViews: (order: number[]) =>
    call<{ views: View[] }>('/api/views/order', { method: 'PUT', body: JSON.stringify({ order }) }),
  shareView: (id: number) => call<{ view: View }>(`/api/views/${id}/share`, { method: 'POST' }),
  unshareView: (id: number) => call<{ view: View }>(`/api/views/${id}/share`, { method: 'DELETE' }),

  sharedView: (token: string) => call<SharedViewDto>(`/api/shared/${encodeURIComponent(token)}`),
  sharedCustomEvents: (token: string) =>
    call<SharedCustomEventsDto>(`/api/shared/${encodeURIComponent(token)}/custom-events`),

  customEvents: () => call<CustomEventsResponse>('/api/custom-events'),
  createCustomEvent: (data: CustomEventData) =>
    call<{ event: CustomEventDto }>('/api/custom-events', { method: 'POST', body: JSON.stringify(data) }),
  updateCustomEvent: (id: number, data: CustomEventData) =>
    call<{ event: CustomEventDto }>(`/api/custom-events/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  deleteCustomEvent: (id: number) => call<{ ok: true }>(`/api/custom-events/${id}`, { method: 'DELETE' }),

  createEventLabel: (data: EventLabelInput) =>
    call<{ label: EventLabelDto }>('/api/event-labels', { method: 'POST', body: JSON.stringify(data) }),
  updateEventLabel: (id: number, data: EventLabelInput) =>
    call<{ label: EventLabelDto }>(`/api/event-labels/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  deleteEventLabel: (id: number) => call<{ ok: true }>(`/api/event-labels/${id}`, { method: 'DELETE' }),

  guestImport: (data: GuestImportInput) =>
    call<{ ok: true }>('/api/guest-import', { method: 'POST', body: JSON.stringify(data) }),

  prefs: () => call<{ activeViewId: number | null; lang: Lang }>('/api/prefs'),
  setPrefs: (patch: { activeViewId?: number | null; lang?: Lang }) =>
    call<{ activeViewId: number | null; lang: Lang }>('/api/prefs', { method: 'PUT', body: JSON.stringify(patch) }),

  adminOverview: () => call<AdminOverviewDto>('/api/admin/overview'),
  adminPromoteSource: (id: number, program: string) =>
    call<{ ok: true }>(`/api/admin/sources/${id}/promote`, { method: 'POST', body: JSON.stringify({ program }) }),
  adminCheckSource: (id: number) =>
    call<{ ok: true } | { ok: false; error: string }>(`/api/admin/sources/${id}/check`, { method: 'POST' }),
};
