// "Standard only" mode, like veg mode in food apps: one switch, remembered on this phone and
// applied to every shop's product list until it is turned off.
import { useCallback, useSyncExternalStore } from 'react';

const KEY = 'pp.standardOnly';
const listeners = new Set<() => void>();

function read(): boolean {
  try {
    return localStorage.getItem(KEY) === '1';
  } catch {
    return false;
  }
}

function subscribe(cb: () => void) {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

export function useStandardMode(): [boolean, (on: boolean) => void] {
  const on = useSyncExternalStore(subscribe, read, () => false);
  const set = useCallback((next: boolean) => {
    try {
      if (next) localStorage.setItem(KEY, '1');
      else localStorage.removeItem(KEY);
    } catch {
      // storage unavailable: the switch still works for this visit
    }
    listeners.forEach((l) => l());
  }, []);
  return [on, set];
}
