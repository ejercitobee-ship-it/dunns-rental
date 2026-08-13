import { useEffect, useState } from 'react';
import { ArrowUp } from 'lucide-react';

/**
 * A floating "back to top" button that fades in once the user scrolls
 * past 400px. Sits in the bottom-right corner and smoothly scrolls back
 * to the top on click. Uses opacity for symmetric enter/exit.
 */
export function BackToTop() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const onScroll = () => setVisible(window.scrollY > 400);
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  return (
    <button
      onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
      className={`fixed bottom-6 right-6 z-40 p-2.5 rounded-full bg-primary text-white shadow-lg hover:bg-primary-hover transition-all duration-200 ${
        visible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-2 pointer-events-none'
      }`}
      aria-label="Back to top"
    >
      <ArrowUp className="h-4 w-4" />
    </button>
  );
}
