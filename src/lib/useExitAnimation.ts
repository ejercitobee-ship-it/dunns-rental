import { useEffect, useRef, useState } from 'react';

/**
 * Keeps a component mounted during its CSS exit animation before unmounting.
 *
 * Returns `{ mounted, phase }`:
 * - `mounted`: whether to render the portal content at all
 * - `phase`: 'entering' | 'exiting' — apply the matching CSS class
 *
 * When `isOpen` goes true → mounted=true, phase='entering'.
 * When `isOpen` goes false → phase='exiting'; after `exitMs` the component
 * unmounts (mounted=false). The exit animation plays during that window.
 */
export function useExitAnimation(isOpen: boolean, exitMs = 180) {
  const [mounted, setMounted] = useState(isOpen);
  const [phase, setPhase] = useState<'entering' | 'exiting'>(isOpen ? 'entering' : 'exiting');
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (isOpen) {
      // Opening: mount immediately and enter.
      if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null; }
      setMounted(true);
      setPhase('entering');
    } else if (mounted) {
      // Closing: play exit animation, then unmount.
      setPhase('exiting');
      timerRef.current = setTimeout(() => {
        setMounted(false);
        timerRef.current = null;
      }, exitMs);
    }
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, exitMs]);

  return { mounted, phase };
}
