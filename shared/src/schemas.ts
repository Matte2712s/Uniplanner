import { z } from 'zod';
import { hasControlOrInvisibleChars } from './textSanitize.ts';

export const MAX_VIEWS_PER_USER = 30;
export const MAX_CUSTOM_SOURCES_PER_USER = 10;
export const MAX_FOLDERS_PER_USER = 20;
export const MAX_FOLDER_NAME_LENGTH = 60;
export const MAX_RANGE_DAYS = 45;
// Course discovery needs a much wider window (a full academic year) than
// any single calendar view render, but it must still be bounded.
export const MAX_COURSES_RANGE_DAYS = 400;

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
}

export interface SourceDto {
  id: number;
  kind: 'default' | 'custom';
  host: string;
  linkCalendarioId: string;
  title: string;
  titleEn: string | null;
  url: string;
  // Config-seeded folder label (default sources only)
  group: string | null;
  // Which of the user's own folders this sits in
  folderId: number | null;
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
