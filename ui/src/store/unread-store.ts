import { useSyncExternalStore } from "react";

type UnreadMap = Record<string, number>;

function createUnreadStore() {
  let state: UnreadMap = {};
  let activeKey: string | null = null;
  const lastReadTs: Record<string, number> = {};
  const listeners = new Set<() => void>();

  const notify = () => {
    for (const fn of listeners) fn();
  };

  const subscribe = (fn: () => void) => {
    listeners.add(fn);
    return () => listeners.delete(fn);
  };

  const getSnapshot = () => state;

  /** Increment unread for a key (agent name for DMs, "ch:name" for channels).
   *  Skips the currently active view. */
  const increment = (key: string) => {
    if (key === activeKey) return;
    state = { ...state, [key]: (state[key] ?? 0) + 1 };
    notify();
  };

  /** Set the currently viewed key — clears its unread count. */
  const setActive = (key: string | null) => {
    activeKey = key;
    if (key) {
      lastReadTs[key] = Date.now();
      if (state[key]) {
        state = { ...state, [key]: 0 };
        notify();
      }
    }
  };

  /** Recompute unread from persisted data — call after baseline refetch. */
  const reconcileFromBaseline = (
    key: string,
    messages: { role: string; ts: number }[],
  ) => {
    if (key === activeKey) return;
    const watermark = lastReadTs[key] ?? 0;
    const unread = messages.filter(
      (m) => m.role === "assistant" && m.ts > watermark,
    ).length;
    if (unread !== (state[key] ?? 0)) {
      state = { ...state, [key]: unread };
      notify();
    }
  };

  return {
    subscribe,
    getSnapshot,
    increment,
    setActive,
    reconcileFromBaseline,
  };
}

export const unreadStore = createUnreadStore();

export function useUnreadCounts(): UnreadMap {
  return useSyncExternalStore(unreadStore.subscribe, unreadStore.getSnapshot);
}
