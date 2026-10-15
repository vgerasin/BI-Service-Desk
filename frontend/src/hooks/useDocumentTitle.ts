import { useEffect } from 'react';
import { APP_NAME as BRAND } from '../branding';


/** Overrides the route-level title (set by PageTitleManager) with a page-specific one,
 *  e.g. the loaded entity's name. Pass undefined/'' while data is still loading to leave
 *  the route title in place instead of flashing an empty title. No unmount restore —
 *  PageTitleManager sets a fresh base title on every navigation anyway. */
export function useDocumentTitle(title?: string | null) {
  useEffect(() => {
    if (!title) return;
    document.title = `${title} - ${BRAND}`;
  }, [title]);
}
