import { useCallback, useSyncExternalStore } from "react";

interface FeedEvent {
  id: number;
  type: string;
  data: unknown;
  timestamp: number;
}

const MAX_EVENTS = 2000;

/** Client-side event ring store for the chat feed. Only receives chat-relevant SSE events.
 *  Uses requestAnimationFrame batching so rapid SSE pushes coalesce into a single React render. */
function createEventStore() {
  let events: FeedEvent[] = [];
  let nextId = 1;
  const listeners = new Set<() => void>();
  let rafId: number | null = null;

  const notify = () => {
    for (const fn of listeners) fn();
  };

  const scheduleNotify = () => {
    if (rafId !== null) return;
    rafId = requestAnimationFrame(() => {
      rafId = null;
      notify();
    });
  };

  const subscribe = (fn: () => void) => {
    listeners.add(fn);
    return () => listeners.delete(fn);
  };

  const getSnapshot = () => events;

  const push = (type: string, data: unknown) => {
    events = [...events, { id: nextId++, type, data, timestamp: Date.now() }];
    if (events.length > MAX_EVENTS) events = events.slice(-MAX_EVENTS);
    scheduleNotify();
  };

  const clear = () => {
    events = [];
    notify();
  };

  return { subscribe, getSnapshot, push, clear };
}

const store = createEventStore();

export function useEventStore() {
  const events = useSyncExternalStore(store.subscribe, store.getSnapshot);
  const push = useCallback(
    (type: string, data: unknown) => store.push(type, data),
    [],
  );
  return { events, push };
}

export function pushEvent(type: string, data: unknown) {
  store.push(type, data);
}

export type { FeedEvent };
