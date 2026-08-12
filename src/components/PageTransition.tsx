import { useLocation } from 'react-router-dom';

/**
 * Wraps page content with a subtle enter animation on every route change.
 * Uses the router's location key (unique per navigation) as the React key,
 * which forces the wrapper to remount and replay the CSS animation.
 *
 * The animation is a quick fade-in with a slight upward slide, tuned to feel
 * instant on desktop and natural on mobile. prefers-reduced-motion is already
 * handled globally in index.css (animation-duration collapses to 0).
 */
export function PageTransition({ children }: { children: React.ReactNode }) {
  const location = useLocation();
  return (
    <div key={location.key} className="page-enter">
      {children}
    </div>
  );
}
