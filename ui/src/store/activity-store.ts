import { useCallback, useSyncExternalStore } from "react";
import type { AgentActivityEntry } from "../api/types.js";

export type LiveActivity = AgentActivityEntry & { agent: string };

const MAX_PER_AGENT = 3000;
const EMPTY: AgentActivityEntry[] = [];

/** Activity entries streamed over SSE since the page loaded, per agent. */
function createActivityStore() {
  let byAgent: Record<string, AgentActivityEntry[]> = {};
  const listeners = new Set<() => void>();

  const subscribe = (fn: () => void) => {
    listeners.add(fn);
    return () => listeners.delete(fn);
  };

  const push = ({ agent, ...entry }: LiveActivity) => {
    if (!agent) return;
    const list = [...(byAgent[agent] ?? []), entry];
    byAgent = {
      ...byAgent,
      [agent]: list.length > MAX_PER_AGENT ? list.slice(-MAX_PER_AGENT) : list,
    };
    for (const fn of listeners) fn();
  };

  const get = (agent: string) => byAgent[agent] ?? EMPTY;

  return { subscribe, push, get };
}

export const activityStore = createActivityStore();

export function useLiveActivity(agent: string): AgentActivityEntry[] {
  const getSnapshot = useCallback(() => activityStore.get(agent), [agent]);
  return useSyncExternalStore(activityStore.subscribe, getSnapshot);
}
