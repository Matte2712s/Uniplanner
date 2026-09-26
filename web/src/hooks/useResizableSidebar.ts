import { useCallback, useEffect, useRef, useState } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent, PointerEvent as ReactPointerEvent } from 'react';

const KEY = 'planner.sidebarWidth';
const MIN = 220;
const MAX = 480;
const DEFAULT = 280;
const KEY_STEP = 20;

function readStored(): number {
  try {
    const v = Number(localStorage.getItem(KEY));
    return v >= MIN && v <= MAX ? v : DEFAULT;
  } catch {
    return DEFAULT;
  }
}

/** Drag-to-resize width for the desktop sidebar, remembered per browser. */
export function useResizableSidebar() {
  const [width, setWidth] = useState(readStored);
  const [dragging, setDragging] = useState(false);
  const start = useRef({ x: 0, width: DEFAULT });

  useEffect(() => {
    if (!dragging) return;
    const prevCursor = document.body.style.cursor;
    const prevUserSelect = document.body.style.userSelect;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';

    function onMove(e: PointerEvent) {
      const next = Math.min(MAX, Math.max(MIN, start.current.width + (e.clientX - start.current.x)));
      setWidth(next);
    }
    function onUp() {
      setDragging(false);
    }
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      document.body.style.cursor = prevCursor;
      document.body.style.userSelect = prevUserSelect;
    };
  }, [dragging]);

  // Persist only the settled width, not every in-flight drag frame.
  useEffect(() => {
    if (dragging) return;
    try {
      localStorage.setItem(KEY, String(width));
    } catch {
      // localStorage unavailable: width just won't survive a reload
    }
  }, [width, dragging]);

  const onPointerDown = useCallback(
    (e: ReactPointerEvent) => {
      start.current = { x: e.clientX, width };
      setDragging(true);
    },
    [width],
  );

  const onKeyDown = useCallback((e: ReactKeyboardEvent) => {
    if (e.key === 'ArrowLeft') setWidth((w) => Math.max(MIN, w - KEY_STEP));
    else if (e.key === 'ArrowRight') setWidth((w) => Math.min(MAX, w + KEY_STEP));
    else return;
    e.preventDefault();
  }, []);

  return { width, min: MIN, max: MAX, dragging, onPointerDown, onKeyDown };
}
