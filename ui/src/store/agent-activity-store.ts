import { useSyncExternalStore } from "react";

export type AgentActivity =
  | { kind: "idle" }
  | { kind: "thinking"; since: number }
  | { kind: "tool"; toolName: string; since: number };

const IDLE: AgentActivity = { kind: "idle" };
type ActivityMap = Record<string, AgentActivity>;

function createAgentActivityStore() {
  let state: ActivityMap = {};
  const listeners = new Set<() => void>();

  const notify = () => {
    for (const fn of listeners) fn();
  };

  const subscribe = (fn: () => void) => {
    listeners.add(fn);
    return () => listeners.delete(fn);
  };

  const getSnapshot = () => state;

  const setActivity = (agent: string, activity: AgentActivity) => {
    if (state[agent]?.kind === activity.kind) {
      if (activity.kind === "idle" || activity.kind === "thinking") return;
      if (
        activity.kind === "tool" &&
        state[agent]?.kind === "tool" &&
        (state[agent] as { toolName: string }).toolName === activity.toolName
      )
        return;
    }
    state = { ...state, [agent]: activity };
    notify();
  };

  const handleEvent = (
    eventType: string,
    agent: string,
    data: Record<string, unknown>,
  ) => {
    if (!agent) return;

    switch (eventType) {
      case "turn_start":
        setActivity(agent, { kind: "thinking", since: Date.now() });
        break;
      case "tool_execution_start":
        setActivity(agent, {
          kind: "tool",
          toolName: (data.toolName as string) ?? "unknown",
          since: Date.now(),
        });
        break;
      case "tool_execution_end":
        setActivity(agent, { kind: "thinking", since: Date.now() });
        break;
      case "message_end":
      case "turn_end":
        setActivity(agent, { kind: "thinking", since: Date.now() });
        break;
      case "agent_end":
        setActivity(agent, { kind: "idle" });
        break;
    }
  };

  const getActivity = (agent: string): AgentActivity => {
    return state[agent] ?? IDLE;
  };

  return { subscribe, getSnapshot, handleEvent, getActivity };
}

export const agentActivityStore = createAgentActivityStore();

export function useAgentActivity() {
  const state = useSyncExternalStore(
    agentActivityStore.subscribe,
    agentActivityStore.getSnapshot,
  );
  return state;
}

export function useAgentActivityFor(agent: string): AgentActivity {
  const state = useAgentActivity();
  return state[agent] ?? IDLE;
}
