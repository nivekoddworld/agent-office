import { useCallback, useSyncExternalStore } from "react";

interface FeedEvent {
  id: number;
  type: string;
  data: unknown;
  timestamp: number;
}

const MAX_EVENTS = 2000;

/** Client-side event ring store for the live feed. */
function createEventStore() {
  let events: FeedEvent[] = [];
  let nextId = 1;
  const listeners = new Set<() => void>();

  const subscribe = (fn: () => void) => {
    listeners.add(fn);
    return () => listeners.delete(fn);
  };

  const getSnapshot = () => events;

  const push = (type: string, data: unknown) => {
    events = [
      ...events,
      { id: nextId++, type, data, timestamp: Date.now() },
    ];
    if (events.length > MAX_EVENTS) events = events.slice(-MAX_EVENTS);
    for (const fn of listeners) fn();
  };

  const clear = () => {
    events = [];
    for (const fn of listeners) fn();
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
