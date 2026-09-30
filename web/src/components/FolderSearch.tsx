import { useQueries, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { CourseDto, SourceDto, ViewSettings } from '@planner/shared';
import { isCourseVisible } from '@planner/shared';
import { api } from '../api/client.ts';
import { colorForCourse } from '../lib/color.ts';
import { CINECA_QUERY_RETRY, cinecaRetryDelay } from '../lib/retry.ts';
import { COURSES_FROM, COURSES_STALE_MS, COURSES_TO, normalizeSearch, refreshCourses, toggleCourse } from './SourceBlock.tsx';

const MAX_RESULTS = 100;
const LOAD_CONCURRENCY = 3;

interface Hit {
  source: SourceDto;
  course: CourseDto;
}

export function FolderSearch({
  sources,
  settings,
  onChange,
}: {
  sources: SourceDto[];
  settings: ViewSettings;
  onChange: (settings: ViewSettings) => void;
}) {
  const { t, i18n } = useTranslation();
  const [search, setSearch] = useState('');

  // Same query key as SourceBlock so results are shared. Each source costs ~58
  // upstream requests, so only a few load at once or Cineca starts failing.
  // Query i is enabled while fewer than LOAD_CONCURRENCY earlier ones are unsettled.
  const settled = useRef<boolean[]>([]);
  const queries = useQueries({
    queries: sources.map((s, i) => {
      const inFlight = settled.current.slice(0, i).filter((done) => !done).length;
      return {
        queryKey: ['courses', s.id],
        queryFn: () => api.sourceCourses(s.id, COURSES_FROM, COURSES_TO),
        enabled: inFlight < LOAD_CONCURRENCY,
        staleTime: COURSES_STALE_MS,
        retry: CINECA_QUERY_RETRY,
        retryDelay: cinecaRetryDelay,
      };
    }),
  });
  settled.current = queries.map((q) => q.status !== 'pending');
  const done = queries.filter((q) => q.status === 'success').length;
  const loading = queries.some((q) => q.status === 'pending');
  const failed = queries.filter((q) => q.isError).length;

  // Rebuild every source in the folder, LOAD_CONCURRENCY at a time
  const queryClient = useQueryClient();
  const [refreshProgress, setRefreshProgress] = useState<{ done: number; failed: number } | null>(null);
  async function refreshAll() {
    const progress = { done: 0, failed: 0 };
    setRefreshProgress({ ...progress });
    let next = 0;
    const worker = async () => {
      while (next < sources.length) {
        const source = sources[next++]!;
        try {
          await refreshCourses(queryClient, source.id);
        } catch {
          progress.failed += 1;
        }
        progress.done += 1;
        setRefreshProgress({ ...progress });
      }
    };
    await Promise.all(Array.from({ length: LOAD_CONCURRENCY }, worker));
    setRefreshProgress(progress.failed > 0 ? { ...progress } : null);
  }
  const refreshing = refreshProgress !== null && refreshProgress.done < sources.length;

  // Retry each failed source once automatically after the first pass. The
  // server keeps the weeks it already fetched, so a retry resumes the work.
  const autoRetried = useRef(new Set<number>());
  const autoRetrying = useRef(false);
  useEffect(() => {
    if (loading || autoRetrying.current) return;
    const todo = queries.flatMap((q, i) => (q.isError && !autoRetried.current.has(sources[i]!.id) ? [{ q, id: sources[i]!.id }] : []));
    if (todo.length === 0) return;
    autoRetrying.current = true;
    todo.forEach(({ id }) => autoRetried.current.add(id));
    let next = 0;
    const worker = async () => {
      while (next < todo.length) await todo[next++]!.q.refetch();
    };
    void Promise.all(Array.from({ length: LOAD_CONCURRENCY }, worker)).finally(() => {
      autoRetrying.current = false;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, failed]);

  function retryFailed() {
    queries.forEach((q) => {
      if (q.isError) void q.refetch();
    });
  }

  const query = normalizeSearch(search.trim());
  const hits: Hit[] = [];
  if (query) {
    queries.forEach((q, i) => {
      for (const course of q.data?.courses ?? []) {
        if (normalizeSearch(`${course.name} ${course.nameEn ?? ''} ${course.partition ?? ''}`).includes(query)) {
          hits.push({ source: sources[i]!, course });
        }
      }
    });
  }

  function sourceTitle(s: SourceDto): string {
    return s.displayName || (i18n.language === 'en' ? s.titleEn || s.title : s.title);
  }

  function toggle({ source, course }: Hit) {
    const viewSource = settings.sources.find((s) => s.sourceId === source.id);
    if (!viewSource) {
      // Enable source showing only this course
      onChange({ ...settings, sources: [...settings.sources, { sourceId: source.id, courseMode: 'include', courses: [course.key] }] });
      return;
    }
    const next = toggleCourse(viewSource, course.key);
    onChange({ ...settings, sources: settings.sources.map((s) => (s.sourceId === source.id ? next : s)) });
  }

  return (
    <div className="folder-search">
      <input
        type="search"
        className="course-search"
        autoFocus
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder={t('folders.searchPlaceholder')}
        aria-label={t('folders.search')}
      />
      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <button className="text-btn" title={t('folders.refreshHint')} onClick={() => void refreshAll()} disabled={refreshing}>
          {refreshing && <span className="spinner" />}{' '}
          {refreshing
            ? t('folders.refreshing', { done: refreshProgress.done, total: sources.length })
            : t('folders.refresh')}
        </button>
        {!refreshing && refreshProgress && refreshProgress.failed > 0 && (
          <span className="error-text">{t('folders.refreshFailed', { count: refreshProgress.failed })}</span>
        )}
      </div>
      {(loading || refreshing) && (
        <p className="hint">
          {loading && (
            <>
              <span className="spinner" /> {t('folders.searchLoading', { done, total: sources.length })}{' '}
            </>
          )}
          {sources.length > LOAD_CONCURRENCY && t('folders.slowHint')}
        </p>
      )}
      {failed > 0 && (
        <p className="error-text">
          {t('folders.searchPartialError', { count: failed })}{' '}
          <button className="text-btn" onClick={retryFailed}>
            {t('action.retry')}
          </button>
        </p>
      )}
      {query && !loading && hits.length === 0 && <p className="hint">{t('sidebar.noCourses')}</p>}
      {hits.length > 0 && (
        <div className="course-list folder-search-results">
          {hits.slice(0, MAX_RESULTS).map((hit) => {
            const { source, course } = hit;
            const viewSource = settings.sources.find((s) => s.sourceId === source.id);
            const visible = viewSource ? isCourseVisible(viewSource, course.key) : false;
            const name = i18n.language === 'en' && course.nameEn ? course.nameEn : course.name;
            return (
              <label className="course-row" key={`${source.id}-${course.key}`}>
                <input type="checkbox" checked={visible} onChange={() => toggle(hit)} />
                <span className="course-dot" style={{ background: colorForCourse(course.key, settings.colors) }} />
                <span className="course-name" title={name}>
                  {name}
                  {course.partition ? ` - ${course.partition}` : ''}
                  <span className="name-group"> - {sourceTitle(source)}</span>
                </span>
              </label>
            );
          })}
          {hits.length > MAX_RESULTS && <p className="hint">{t('folders.searchMore', { count: hits.length - MAX_RESULTS })}</p>}
        </div>
      )}
    </div>
  );
}
