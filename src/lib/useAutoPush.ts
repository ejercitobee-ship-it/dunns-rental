import { useEffect } from 'react';
import { isPushSupported, enablePush } from './push';

/**
 * Turns push notifications on automatically for this device. Notifications are
 * on by default for tenants: there is no in-app switch to turn them off.
 *
 * The one thing no app can bypass is the device's own permission: the browser
 * and phone require the person to allow notifications once. So on the tenant's
 * first interaction in the app we request that permission and subscribe them
 * silently. Requesting inside a real tap is also what iPhones require. If the
 * device already granted permission, this subscribes immediately with no
 * prompt. If the device blocked notifications, only the phone's own settings
 * can undo that, which is outside the app's control.
 */
export function useAutoEnablePush(enabled: boolean): void {
  useEffect(() => {
    if (!enabled || !isPushSupported()) return;

    let done = false;
    const cleanups: Array<() => void> = [];

    const run = () => {
      if (done) return;
      done = true;
      for (const fn of cleanups) fn();
      // When permission is already granted this is silent; when it is still
      // undecided, run() is called from inside the user's tap, which every
      // platform (notably iOS) accepts as the required gesture.
      enablePush().catch(() => {
        // Denied or dismissed: the device owns this choice, nothing more to do.
      });
    };

    if (Notification.permission === 'granted') {
      run(); // Already allowed: make sure this device is subscribed.
      return;
    }
    if (Notification.permission === 'denied') {
      return; // Blocked at the device level; the app cannot override it.
    }

    // Not decided yet: enable on the first interaction so the permission
    // request rides a genuine user gesture.
    const events: Array<keyof DocumentEventMap> = ['pointerdown', 'keydown'];
    for (const ev of events) {
      document.addEventListener(ev, run, { once: true, passive: true });
      cleanups.push(() => document.removeEventListener(ev, run));
    }

    return () => {
      done = true;
      for (const fn of cleanups) fn();
    };
  }, [enabled]);
}
