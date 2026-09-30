import { z } from 'zod';
import { hasControlOrInvisibleChars } from './textSanitize.ts';

export const MAX_VIEWS_PER_USER = 30;
export const MAX_CUSTOM_SOURCES_PER_USER = 10;
export const MAX_FOLDERS_PER_USER = 20;
export const MAX_FOLDER_NAME_LENGTH = 60;
export const MAX_SOURCE_NAME_LENGTH = 120;
export const MAX_RANGE_DAYS = 45;
// Course discovery needs a much wider window (a full academic year) than
// any single calendar view render, but it must still be bounded.
export const MAX_COURSES_RANGE_DAYS = 400;
// Course list window around now. The client request and the server warmer must
// match, and lookback + lookahead must not exceed MAX_COURSES_RANGE_DAYS.
export const COURSES_LOOKBACK_DAYS = 120;
export const COURSES_LOOKAHEAD_DAYS = 280;
// A custom source's last_ok_at older than this (or never set) is flagged stale in the admin dashboard.
export const ADMIN_STALE_SOURCE_DAYS = 30;

export const courseKeySchema = z.string().min(1).max(400);
export const hexColorSchema = z.string().regex(/^#[0-9a-fA-F]{6}$/);

export const viewSourceSchema = z.object({
  sourceId: z.number().int().positive(),
  // include: only listed courses; exclude: all but listed (new courses auto-included)
  courseMode: z.enum(['include', 'exclude']).default('exclude'),
  courses: z.array(courseKeySchema).max(500).default([]),
});

export const calendarModeSchema = z.enum(['week', 'day', 'month', 'list']);

export const viewSettingsSchema = z.object({
  sources: z.array(viewSourceSchema).max(20).default([]),
  calendarMode: calendarModeSchema.default('week'),
  hideWeekends: z.boolean().default(true),
  showCancelled: z.boolean().default(true),
  colors: z
    .record(courseKeySchema, hexColorSchema)
    .refine((r) => Object.keys(r).length <= 500, 'too many colors')
    .default({}),
});

export const viewNameSchema = z.string().trim().min(1).max(60);

export const folderNameSchema = z
  .string()
  .trim()
  .min(1)
  .max(MAX_FOLDER_NAME_LENGTH)
  .refine((s) => !hasControlOrInvisibleChars(s), 'invalid_chars');

export const folderInputSchema = z.object({ name: folderNameSchema });

export const folderPatchSchema = z.object({
  name: folderNameSchema.optional(),
  parentId: z.number().int().positive().nullable().optional(),
});

export const sourcePlacementSchema = z.object({
  folderId: z.number().int().positive().nullable(),
});

export type SourcePlacement = z.infer<typeof sourcePlacementSchema>;

export const sourceNameSchema = z
  .string()
  .trim()
  .min(1)
  .max(MAX_SOURCE_NAME_LENGTH)
  .refine((s) => !hasControlOrInvisibleChars(s), 'invalid_chars');

export const sourceRenameSchema = z.object({ name: sourceNameSchema });

export const viewInputSchema = z.object({
  name: viewNameSchema,
  settings: viewSettingsSchema,
});

export const viewPatchSchema = z.object({
  name: viewNameSchema.optional(),
  settings: viewSettingsSchema.optional(),
});

export const langSchema = z.enum(['it', 'en']);

export const prefsSchema = z.object({
  activeViewId: z.number().int().positive().nullable().optional(),
  lang: langSchema.optional(),
});

export const eventsQuerySchema = z.object({
  from: z.string().datetime({ offset: true }),
  to: z.string().datetime({ offset: true }),
  settings: viewSettingsSchema,
});

export type ViewSource = z.infer<typeof viewSourceSchema>;
export type ViewSettings = z.infer<typeof viewSettingsSchema>;
export type CalendarMode = z.infer<typeof calendarModeSchema>;
export type Lang = z.infer<typeof langSchema>;

export interface View {
  id: number;
  name: string;
  position: number;
  settings: ViewSettings;
  updatedAt: string;
  // Public share link token; null when this view isn't shared.
  shareToken: string | null;
}

export interface SharedViewDto {
  name: string;
  settings: ViewSettings;
}

export interface SourceDto {
  id: number;
  kind: 'default' | 'custom';
  host: string;
  linkCalendarioId: string;
  title: string;
  titleEn: string | null;
  url: string;
  // Config-seeded folder path, root to leaf (default sources only); empty when ungrouped
  groupPath: string[];
  // Which of the user's own folders this sits in
  folderId: number | null;
  // Per-user rename override (falls back to title/titleEn when null)
  displayName: string | null;
}

export interface FolderDto {
  id: number;
  name: string;
  position: number;
  parentId: number | null;
}

// A supported degree program (e.g. "Informatica") a user can opt into -
// distinct from CourseDto below, which is an individual university course
// (e.g. "Analisi Matematica 1") within a calendar feed.
export interface ProgramDto {
  program: string;
  sources: SourceDto[];
  added: boolean;
}

export interface CourseDto {
  key: string;
  code: string;
  name: string;
  nameEn: string | null;
  partition: string | null;
}

export type EventStatus = 'ok' | 'cancelled' | 'suspended';

export interface RoomDto {
  name: string;
  building: string | null;
}

export interface CalendarEventDto {
  id: string;
  sourceId: number;
  courseKey: string;
  courseCode: string;
  courseName: string;
  courseNameEn: string | null;
  activity: string | null;
  partition: string | null;
  start: string;
  end: string;
  teachers: string[];
  rooms: RoomDto[];
  status: EventStatus;
  online: boolean;
  onlineUrl: string | null;
  notes: string | null;
  notesEn: string | null;
}

export interface EventsResponse {
  events: CalendarEventDto[];
  errors: { sourceId: number; message: string }[];
}

export interface MeDto {
  id: number;
  email: string;
  name: string;
  pictureUrl: string | null;
  // UX hint only (whether to show the admin entry point) - every /api/admin/*
  // route re-derives this from the session itself, never trusts this flag.
  isAdmin: boolean;
}

export const promoteSourceSchema = z.object({
  program: z
    .string()
    .trim()
    .min(1)
    .max(200)
    .refine((s) => !hasControlOrInvisibleChars(s), 'invalid_chars'),
});

export interface AdminUserDto {
  id: number;
  email: string;
  name: string;
  createdAt: string;
  pictureUrl: string | null;
  viewCount: number;
  customSourceCount: number;
}

export interface AdminCustomSourceDto {
  id: number;
  host: string;
  linkCalendarioId: string;
  title: string;
  titleEn: string | null;
  url: string;
  createdByEmail: string | null;
  lastOkAt: string | null;
  linkedUserCount: number;
  // lastOkAt is null, or older than ADMIN_STALE_SOURCE_DAYS
  stale: boolean;
}

export interface AdminStatsDto {
  userCount: number;
  activeSessionCount: number;
  eventCache: { rowCount: number; distinctSourceCount: number; newestFetchedAt: number | null };
  resource: { dbSizeBytes: number; uptimeSeconds: number; rssBytes: number };
}

export interface AdminDefaultSourceDto {
  id: number;
  host: string;
  linkCalendarioId: string;
  title: string;
  titleEn: string | null;
  url: string;
  program: string | null;
  groupPath: string[];
  linkedUserCount: number;
}

export interface AdminOverviewDto {
  stats: AdminStatsDto;
  users: AdminUserDto[];
  customSources: AdminCustomSourceDto[];
  defaultSources: AdminDefaultSourceDto[];
  existingPrograms: string[];
}

export function defaultViewSettings(): ViewSettings {
  return viewSettingsSchema.parse({});
}

export function courseKeyOf(code: string, name: string): string {
  return `${code}|${name}`;
}

export function isCourseVisible(source: ViewSource, courseKey: string): boolean {
  const listed = source.courses.includes(courseKey);
  return source.courseMode === 'include' ? listed : !listed;
}
