import { useSyncExternalStore } from "react";

interface Preferences {
  showSystemEvents: boolean;
}

const STORAGE_KEY = "ao-preferences";

const DEFAULTS: Preferences = {
  showSystemEvents: true,
};

function loadFromStorage(): Preferences {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return { ...DEFAULTS, ...JSON.parse(raw) };
  } catch {
    /* ignore */
  }
  return { ...DEFAULTS };
}

function createPreferencesStore() {
  let state = loadFromStorage();
  const listeners = new Set<() => void>();

  const notify = () => {
    for (const fn of listeners) fn();
  };

  const persist = () => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch {
      /* ignore */
    }
  };

  const subscribe = (fn: () => void) => {
    listeners.add(fn);
    return () => listeners.delete(fn);
  };

  const getSnapshot = () => state;

  const toggleShowSystemEvents = () => {
    state = { ...state, showSystemEvents: !state.showSystemEvents };
    persist();
    notify();
  };

  return { subscribe, getSnapshot, toggleShowSystemEvents };
}

export const preferencesStore = createPreferencesStore();

export function usePreferences(): Preferences {
  return useSyncExternalStore(
    preferencesStore.subscribe,
    preferencesStore.getSnapshot,
  );
}
