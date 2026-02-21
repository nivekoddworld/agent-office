import { useMemo, useSyncExternalStore } from "react";
import type { SlackMessageData } from "../components/slack/types.js";

const MAX_THREADS = 200;

export interface Thread {
  id: string;
  agentName: string;
  requestId?: string;
  parentMessage: SlackMessageData;
  replies: SlackMessageData[];
  status: "open" | "completed";
  createdAt: number;
}

interface ThreadState {
  threads: Thread[];
  /** Maps agentName → most recent open threadId for that agent */
  activeThreadByAgent: Record<string, string>;
  /** Maps requestId → threadId (if available from client request metadata) */
  threadByRequestId: Record<string, string>;
}

function pruneThreadMaps(
  threads: Thread[],
  activeThreadByAgent: Record<string, string>,
  threadByRequestId: Record<string, string>,
): Pick<ThreadState, "activeThreadByAgent" | "threadByRequestId"> {
  const ids = new Set(threads.map((t) => t.id));
  const active = Object.fromEntries(
    Object.entries(activeThreadByAgent).filter(([, threadId]) =>
      ids.has(threadId),
    ),
  );
  const byRequestId = Object.fromEntries(
    Object.entries(threadByRequestId).filter(([, threadId]) =>
      ids.has(threadId),
    ),
  );
  return { activeThreadByAgent: active, threadByRequestId: byRequestId };
}

export function createThreadStore() {
  let state: ThreadState = {
    threads: [],
    activeThreadByAgent: {},
    threadByRequestId: {},
  };
  const listeners = new Set<() => void>();

  const notify = () => {
    for (const fn of listeners) fn();
  };

  const subscribe = (fn: () => void) => {
    listeners.add(fn);
    return () => listeners.delete(fn);
  };

  const getSnapshot = () => state;

  const resolveThreadId = (
    agentName: string,
    requestId?: string,
  ): string | undefined => {
    if (requestId) {
      const mapped = state.threadByRequestId[requestId];
      if (mapped) return mapped;
    }
    return state.activeThreadByAgent[agentName];
  };

  /** User sends a message -- creates a new thread. */
  const createThread = (
    agentName: string,
    userMessage: SlackMessageData,
    requestId?: string,
  ): string => {
    const id = `thread-${Date.now()}-${agentName}-${Math.random().toString(36).slice(2, 8)}`;
    const thread: Thread = {
      id,
      agentName,
      requestId,
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
    const activeThreadByAgent = {
      ...state.activeThreadByAgent,
      [agentName]: id,
    };
    const threadByRequestId = requestId
      ? { ...state.threadByRequestId, [requestId]: id }
      : state.threadByRequestId;
    const pruned = pruneThreadMaps(
      threads,
      activeThreadByAgent,
      threadByRequestId,
    );
    state = {
      threads,
      ...pruned,
    };
    notify();
    return id;
  };

  /** Agent responds -- add reply to active thread. */
  const addReply = (
    agentName: string,
    message: SlackMessageData,
    requestId?: string,
  ) => {
    const threadId = resolveThreadId(agentName, requestId);
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
  const completeThread = (agentName: string, requestId?: string) => {
    const threadId = resolveThreadId(agentName, requestId);
    if (!threadId) return;

    const activeThreadByAgent =
      state.activeThreadByAgent[agentName] === threadId
        ? Object.fromEntries(
            Object.entries(state.activeThreadByAgent).filter(
              ([name]) => name !== agentName,
            ),
          )
        : state.activeThreadByAgent;
    const threads = state.threads.map((t) =>
      t.id === threadId ? { ...t, status: "completed" as const } : t,
    );
    const pruned = pruneThreadMaps(
      threads,
      activeThreadByAgent,
      state.threadByRequestId,
    );
    state = {
      threads,
      ...pruned,
    };
    notify();
  };

  /** User replies inside a thread -- reopen it and add user's reply. */
  const replyInThread = (
    threadId: string,
    userMessage: SlackMessageData,
    requestId?: string,
  ) => {
    const thread = state.threads.find((t) => t.id === threadId);
    if (!thread) return;

    const threads = state.threads.map((t) =>
      t.id === threadId
        ? {
            ...t,
            replies: [...t.replies, userMessage],
            status: "open" as const,
            ...(requestId ? { requestId } : {}),
          }
        : t,
    );
    const activeThreadByAgent = {
      ...state.activeThreadByAgent,
      [thread.agentName]: threadId,
    };
    const threadByRequestId = requestId
      ? { ...state.threadByRequestId, [requestId]: threadId }
      : state.threadByRequestId;
    const pruned = pruneThreadMaps(
      threads,
      activeThreadByAgent,
      threadByRequestId,
    );
    state = {
      threads,
      ...pruned,
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
  const state = useSyncExternalStore(
    threadStore.subscribe,
    threadStore.getSnapshot,
  );
  return useMemo(() => ({ ...state, ...threadStore }), [state]);
}
