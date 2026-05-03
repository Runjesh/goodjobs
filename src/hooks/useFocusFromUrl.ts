import { useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';

/**
 * Reads `?<paramName>=<id>` and scrolls the element with
 * `data-focus-id="<id>"` into view, briefly highlighting it. Strips the
 * param afterwards so navigation isn't sticky. Used by Command Palette
 * deep-links into list-style pages (Programs, CSR, Volunteers, Fundraising).
 */
export function useFocusFromUrl(paramName: string): string {
  const [params, setParams] = useSearchParams();
  const focusId = params.get(paramName) || '';

  useEffect(() => {
    if (!focusId) return;
    // Defer to allow target rows to mount.
    const t = setTimeout(() => {
      const el = document.querySelector<HTMLElement>(`[data-focus-id="${CSS.escape(focusId)}"]`);
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        el.classList.add('focus-flash');
        setTimeout(() => el.classList.remove('focus-flash'), 2000);
      }
      const next = new URLSearchParams(params);
      next.delete(paramName);
      setParams(next, { replace: true });
    }, 150);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusId]);

  return focusId;
}
