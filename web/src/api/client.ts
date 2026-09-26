import type {
  CourseDto,
  EventsResponse,
  FolderDto,
  Lang,
  MeDto,
  ProgramDto,
  SourceDto,
  View,
  ViewSettings,
} from '@planner/shared';

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
  setSourcePlacement: (id: number, folderId: number | null) =>
    call<{ ok: true }>(`/api/sources/${id}/placement`, { method: 'PUT', body: JSON.stringify({ folderId }) }),
  sourceCourses: (id: number, from: string, to: string) =>
    call<{ courses: CourseDto[] }>(`/api/sources/${id}/courses?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`),

  createFolder: (name: string) => call<{ folder: FolderDto }>('/api/folders', { method: 'POST', body: JSON.stringify({ name }) }),
  renameFolder: (id: number, name: string) =>
    call<{ folder: FolderDto }>(`/api/folders/${id}`, { method: 'PUT', body: JSON.stringify({ name }) }),
  moveFolder: (id: number, parentId: number | null) =>
    call<{ folder: FolderDto }>(`/api/folders/${id}`, { method: 'PUT', body: JSON.stringify({ parentId }) }),
  deleteFolder: (id: number) => call<{ ok: true }>(`/api/folders/${id}`, { method: 'DELETE' }),

  addProgram: (program: string) =>
    call<{ ok: true; added: number }>(`/api/programs/${encodeURIComponent(program)}/add`, { method: 'POST' }),

  previewEvents: (from: string, to: string, settings: ViewSettings) =>
    call<EventsResponse>('/api/events/preview', { method: 'POST', body: JSON.stringify({ from, to, settings }) }),

  views: () => call<{ views: View[] }>('/api/views'),
  createView: (name: string, settings: ViewSettings) =>
    call<{ view: View }>('/api/views', { method: 'POST', body: JSON.stringify({ name, settings }) }),
  updateView: (id: number, patch: { name?: string; settings?: ViewSettings }) =>
    call<{ view: View }>(`/api/views/${id}`, { method: 'PUT', body: JSON.stringify(patch) }),
  deleteView: (id: number) => call<{ ok: true }>(`/api/views/${id}`, { method: 'DELETE' }),
  reorderViews: (order: number[]) =>
    call<{ views: View[] }>('/api/views/order', { method: 'PUT', body: JSON.stringify({ order }) }),

  prefs: () => call<{ activeViewId: number | null; lang: Lang }>('/api/prefs'),
  setPrefs: (patch: { activeViewId?: number | null; lang?: Lang }) =>
    call<{ activeViewId: number | null; lang: Lang }>('/api/prefs', { method: 'PUT', body: JSON.stringify(patch) }),
};
