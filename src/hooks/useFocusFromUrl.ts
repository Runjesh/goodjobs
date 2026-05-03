import { useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';

/**
 * Options for `useFocusFromUrl`.
 *
 * `resolveIndex` lets virtualized pages map an id to a list index so the
 * row can be scrolled into view (and therefore mounted) before the DOM
 * highlight runs. Pages using `@tanstack/react-virtual` should pass a
 * resolver that calls `virtualizer.scrollToIndex(idx, { align: 'center' })`.
 */
export interface UseFocusFromUrlOptions {
  resolveIndex?: (id: string) => number | null;
  onScrollToIndex?: (idx: number) => void;
}

/**
 * Reads `?<paramName>=<id>` and scrolls the element with
 * `data-focus-id="<id>"` into view, briefly highlighting it.
 *
 * Virtualizer-aware: when `resolveIndex` returns a valid index, the
 * page's `onScrollToIndex` is invoked first so the row mounts; the DOM
 * lookup then runs after a short delay. The URL param is only stripped
 * after a successful focus (or after a final retry) so a refresh while
 * waiting for data still re-attempts.
 */
export function useFocusFromUrl(paramName: string, opts: UseFocusFromUrlOptions = {}): string {
  const [params, setParams] = useSearchParams();
  const focusId = params.get(paramName) || '';

  useEffect(() => {
    if (!focusId) return;
    let cancelled = false;
    const { resolveIndex, onScrollToIndex } = opts;

    const tryFocus = (attempt: number) => {
      if (cancelled) return;
      // Virtualizer hop: ask the page to scroll the matching index into the
      // viewport so the underlying row can mount.
      if (resolveIndex && onScrollToIndex) {
        const idx = resolveIndex(focusId);
        if (idx != null && idx >= 0) onScrollToIndex(idx);
      }
      // After the next paint, look for the now-mounted row.
      setTimeout(() => {
        if (cancelled) return;
        const el = document.querySelector<HTMLElement>(`[data-focus-id="${CSS.escape(focusId)}"]`);
        if (el) {
          el.scrollIntoView({ behavior: 'smooth', block: 'center' });
          el.classList.add('focus-flash');
          setTimeout(() => el.classList.remove('focus-flash'), 2000);
          const next = new URLSearchParams(params);
          next.delete(paramName);
          setParams(next, { replace: true });
        } else if (attempt < 3) {
          // Retry up to 3 times — handles cases where data is still loading.
          tryFocus(attempt + 1);
        } else {
          // Give up and clear the param so it doesn't loop forever.
          const next = new URLSearchParams(params);
          next.delete(paramName);
          setParams(next, { replace: true });
        }
      }, 120 + attempt * 180);
    };

    const initial = setTimeout(() => tryFocus(0), 80);
    return () => { cancelled = true; clearTimeout(initial); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusId]);

  return focusId;
}
