import { useMemo, useSyncExternalStore } from "react";
import type { SlackMessageData } from "../components/slack/SlackMessage.js";

const MAX_THREADS = 200;

export interface Thread {
  id: string;
  agentName: string;
  parentMessage: SlackMessageData;
  replies: SlackMessageData[];
  status: "open" | "completed";
  createdAt: number;
}

interface ThreadState {
  threads: Thread[];
  /** Maps agentName → most recent open threadId for that agent */
  activeThreadByAgent: Record<string, string>;
}

function createThreadStore() {
  let state: ThreadState = { threads: [], activeThreadByAgent: {} };
  const listeners = new Set<() => void>();

  const notify = () => {
    for (const fn of listeners) fn();
  };

  const subscribe = (fn: () => void) => {
    listeners.add(fn);
    return () => listeners.delete(fn);
  };

  const getSnapshot = () => state;

  /** User sends a message -- creates a new thread. */
  const createThread = (agentName: string, userMessage: SlackMessageData): string => {
    const id = `thread-${Date.now()}-${agentName}-${Math.random().toString(36).slice(2, 8)}`;
    const thread: Thread = {
      id,
      agentName,
      parentMessage: userMessage,
      replies: [],
      status: "open",
      createdAt: Date.now(),
    };
    let threads = [...state.threads, thread];
    if (threads.length > MAX_THREADS) {
      const completed = threads.filter((t) => t.status === "completed");
      const evictCount = threads.length - MAX_THREADS;
      const toRemove = new Set(completed.slice(0, evictCount).map((t) => t.id));
      threads = threads.filter((t) => !toRemove.has(t.id));
    }
    state = {
      threads,
      activeThreadByAgent: { ...state.activeThreadByAgent, [agentName]: id },
    };
    notify();
    return id;
  };

  /** Agent responds -- add reply to active thread. */
  const addReply = (agentName: string, message: SlackMessageData) => {
    const threadId = state.activeThreadByAgent[agentName];
    if (!threadId) return;

    state = {
      ...state,
      threads: state.threads.map((t) =>
        t.id === threadId ? { ...t, replies: [...t.replies, message] } : t,
      ),
    };
    notify();
  };

  /** Agent finishes -- mark thread completed. */
  const completeThread = (agentName: string) => {
    const threadId = state.activeThreadByAgent[agentName];
    if (!threadId) return;

    const { [agentName]: _, ...rest } = state.activeThreadByAgent;
    state = {
      activeThreadByAgent: rest,
      threads: state.threads.map((t) =>
        t.id === threadId ? { ...t, status: "completed" as const } : t,
      ),
    };
    notify();
  };

  /** User replies inside a thread -- reopen it and add user's reply. */
  const replyInThread = (threadId: string, userMessage: SlackMessageData) => {
    const thread = state.threads.find((t) => t.id === threadId);
    if (!thread) return;

    state = {
      threads: state.threads.map((t) =>
        t.id === threadId
          ? { ...t, replies: [...t.replies, userMessage], status: "open" as const }
          : t,
      ),
      activeThreadByAgent: {
        ...state.activeThreadByAgent,
        [thread.agentName]: threadId,
      },
    };
    notify();
  };

  const getThread = (threadId: string): Thread | undefined => {
    return state.threads.find((t) => t.id === threadId);
  };

  const getThreadsForAgent = (agentName: string): Thread[] => {
    return state.threads.filter((t) => t.agentName === agentName);
  };

  return {
    subscribe,
    getSnapshot,
    createThread,
    addReply,
    completeThread,
    replyInThread,
    getThread,
    getThreadsForAgent,
  };
}

export const threadStore = createThreadStore();

export function useThreadStore() {
  const state = useSyncExternalStore(threadStore.subscribe, threadStore.getSnapshot);
  return useMemo(() => ({ ...state, ...threadStore }), [state]);
}
