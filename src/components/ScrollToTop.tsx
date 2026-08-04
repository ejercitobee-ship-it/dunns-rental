import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';

/**
 * Scrolls the window to the top whenever the pathname changes.
 * Drop this inside <BrowserRouter> to fix the SPA scroll-position problem
 * where navigating to a new page leaves the scroll where the old page was.
 */
export function ScrollToTop() {
  const { pathname } = useLocation();
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [pathname]);
  return null;
}
