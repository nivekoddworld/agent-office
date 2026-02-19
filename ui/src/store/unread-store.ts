import { useSyncExternalStore } from "react";

type UnreadMap = Record<string, number>;

function createUnreadStore() {
  let state: UnreadMap = {};
  let activeAgent: string | null = null;
  const listeners = new Set<() => void>();

  const notify = () => {
    for (const fn of listeners) fn();
  };

  const subscribe = (fn: () => void) => {
    listeners.add(fn);
    return () => listeners.delete(fn);
  };

  const getSnapshot = () => state;

  /** Call when an assistant message arrives. Skips the currently viewed DM. */
  const increment = (agent: string) => {
    if (agent === activeAgent) return;
    state = { ...state, [agent]: (state[agent] ?? 0) + 1 };
    notify();
  };

  /** Call when user switches to a DM — clears that agent's count and sets active. */
  const setActiveAgent = (agent: string | null) => {
    activeAgent = agent;
    if (agent && state[agent]) {
      state = { ...state, [agent]: 0 };
      notify();
    }
  };

  return { subscribe, getSnapshot, increment, setActiveAgent };
}

export const unreadStore = createUnreadStore();

export function useUnreadCounts(): UnreadMap {
  return useSyncExternalStore(unreadStore.subscribe, unreadStore.getSnapshot);
}
