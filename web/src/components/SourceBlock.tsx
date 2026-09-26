import { useDraggable } from '@dnd-kit/core';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { SourceDto, ViewSettings, ViewSource } from '@planner/shared';
import { isCourseVisible } from '@planner/shared';
import { api } from '../api/client.ts';
import { colorForCourse } from '../lib/color.ts';
import { IconGripVertical, IconPencil, IconTrash } from './icons.tsx';

const COURSES_FROM = new Date(Date.now() - 120 * 24 * 60 * 60 * 1000).toISOString();
const COURSES_TO = new Date(Date.now() + 280 * 24 * 60 * 60 * 1000).toISOString();

function toggleCourse(viewSource: ViewSource, key: string): ViewSource {
  const visible = isCourseVisible(viewSource, key);
  const has = viewSource.courses.includes(key);
  if (viewSource.courseMode === 'exclude') {
    // visible now (not excluded) -> hide by excluding; hidden -> un-exclude
    return { ...viewSource, courses: visible ? [...viewSource.courses, key] : viewSource.courses.filter((c) => c !== key) };
  }
  // include mode: visible means listed; hide by removing, show by adding
  return { ...viewSource, courses: has && visible ? viewSource.courses.filter((c) => c !== key) : [...viewSource.courses, key] };
}

export function SourceBlock({
  source,
  settings,
  onChange,
  onRemove,
  onRename,
}: {
  source: SourceDto;
  settings: ViewSettings;
  onChange: (settings: ViewSettings) => void;
  onRemove: () => void;
  onRename: () => void;
}) {
  const { t, i18n } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  const viewSource = settings.sources.find((s) => s.sourceId === source.id);
  const enabled = Boolean(viewSource);

  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `source-${source.id}`,
    data: { kind: 'source', source },
  });

  const coursesQuery = useQuery({
    queryKey: ['courses', source.id],
    queryFn: () => api.sourceCourses(source.id, COURSES_FROM, COURSES_TO),
    enabled: enabled && expanded,
    staleTime: 10 * 60_000,
  });

  function setEnabled(next: boolean) {
    if (next) {
      onChange({ ...settings, sources: [...settings.sources, { sourceId: source.id, courseMode: 'exclude', courses: [] }] });
      setExpanded(true);
    } else {
      onChange({ ...settings, sources: settings.sources.filter((s) => s.sourceId !== source.id) });
    }
  }

  function updateViewSource(next: ViewSource) {
    onChange({ ...settings, sources: settings.sources.map((s) => (s.sourceId === source.id ? next : s)) });
  }

  function selectAll() {
    if (viewSource) updateViewSource({ ...viewSource, courseMode: 'exclude', courses: [] });
  }
  function selectNone() {
    if (viewSource) updateViewSource({ ...viewSource, courseMode: 'include', courses: [] });
  }

  const title = source.displayName || (i18n.language === 'en' ? source.titleEn || source.title : source.title);
  const courses = coursesQuery.data?.courses ?? [];
  const groupLabel = source.groupPath.length > 0 ? source.groupPath.join(' - ') : null;

  return (
    <div className="source-block" style={{ opacity: isDragging ? 0.4 : 1 }}>
      <div className="source-header">
        <button className="drag-handle" ref={setNodeRef} {...attributes} {...listeners} aria-label={t('sidebar.dragHandle')}>
          <IconGripVertical />
        </button>
        <input
          type="checkbox"
          checked={enabled}
          onChange={(e) => setEnabled(e.target.checked)}
          aria-label={title}
          style={{ width: 20, height: 20 }}
        />
        <span
          className="name"
          title={groupLabel ? `${title} - ${groupLabel}` : title}
          onClick={() => enabled && setExpanded((v) => !v)}
        >
          {title}
          {groupLabel && <span className="name-group"> - {groupLabel}</span>}
        </span>
        <button className="icon-btn" title={t('sidebar.renameSource')} onClick={onRename}>
          <IconPencil />
        </button>
        <button className="icon-btn" title={t('sidebar.removeSource')} onClick={onRemove}>
          <IconTrash />
        </button>
        {enabled && (
          <button className="icon-btn" onClick={() => setExpanded((v) => !v)} aria-label={expanded ? t('nav.closeMenu') : t('nav.openMenu')}>
            {expanded ? '▴' : '▾'}
          </button>
        )}
      </div>

      {enabled && expanded && viewSource && (
        <div className="course-list">
          {coursesQuery.isLoading && <p className="hint">{t('sidebar.loadingCourses')}</p>}
          {coursesQuery.isError && <p className="error-text">{t('sidebar.sourceError')}</p>}
          {!coursesQuery.isLoading && courses.length === 0 && <p className="hint">{t('sidebar.noCourses')}</p>}
          {courses.length > 0 && (
            <div style={{ display: 'flex', gap: 8 }}>
              <button className="text-btn" onClick={selectAll}>
                {t('sidebar.selectAll')}
              </button>
              <button className="text-btn" onClick={selectNone}>
                {t('sidebar.selectNone')}
              </button>
            </div>
          )}
          {courses.map((c) => {
            const visible = isCourseVisible(viewSource, c.key);
            const name = i18n.language === 'en' && c.nameEn ? c.nameEn : c.name;
            return (
              <label className="course-row" key={c.key}>
                <input type="checkbox" checked={visible} onChange={() => updateViewSource(toggleCourse(viewSource, c.key))} />
                <span className="course-dot" style={{ background: colorForCourse(c.key, settings.colors) }} />
                <span className="course-name" title={name}>
                  {name}
                  {c.partition ? ` - ${c.partition}` : ''}
                </span>
              </label>
            );
          })}
        </div>
      )}
    </div>
  );
}
