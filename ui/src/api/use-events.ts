import { useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { BootstrapState, SchedulerState } from "./types.js";

type SSEHandler = (type: string, data: unknown) => void;
type AuthExpiredHandler = () => void;

/**
 * SSE hook — connects to /api/events, auto-reconnects, merges into React Query cache.
 * Uses refs for callbacks to keep the EventSource stable across re-renders.
 * Passes Last-Event-ID on reconnect. Detects auth expiry and stops retrying.
 */
export function useSSE(
  enabled: boolean,
  onEvent?: SSEHandler,
  onAuthExpired?: AuthExpiredHandler,
) {
  const queryClient = useQueryClient();
  const lastIdRef = useRef(0);
  const onEventRef = useRef(onEvent);
  onEventRef.current = onEvent;
  const onAuthExpiredRef = useRef(onAuthExpired);
  onAuthExpiredRef.current = onAuthExpired;

  useEffect(() => {
    if (!enabled) return;

    let es: EventSource | null = null;
    let retryTimer: ReturnType<typeof setTimeout>;
    let stopped = false;

    const handleMessage = (type: string, data: unknown) => {
      if (type === "scheduler_tick") {
        queryClient.setQueryData<BootstrapState>(["state"], (prev) => {
          if (!prev) return prev;
          return { ...prev, scheduler: data as SchedulerState };
        });
      }
      if (type === "snapshot" || type === "state_changed") {
        queryClient.setQueryData(["state"], data as BootstrapState);
        void queryClient.invalidateQueries({ queryKey: ["agent"] });
      }
      // state_changed is silent — don't push to event feed
      if (type !== "state_changed") {
        onEventRef.current?.(type, data);
      }
    };

    const connect = () => {
      if (stopped) return;
      const url = lastIdRef.current
        ? `/api/events?lastEventId=${lastIdRef.current}`
        : "/api/events";
      es = new EventSource(url);

      const listen = (type: string) => {
        es!.addEventListener(type, (e: MessageEvent) => {
          const me = e as MessageEvent;
          if (me.lastEventId) lastIdRef.current = parseInt(me.lastEventId, 10);
          try {
            const data: unknown = JSON.parse(me.data as string);
            handleMessage(type, data);
          } catch {
            // ignore malformed data
          }
        });
      };

      listen("scheduler_tick");
      listen("agent_event");
      listen("heartbeat");
      listen("snapshot");
      listen("state_changed");

      es.onerror = () => {
        es?.close();
        if (stopped) return;
        // Probe session before retrying — stop if auth expired
        fetch("/api/state", { credentials: "same-origin" })
          .then((res) => {
            if (res.status === 401) {
              stopped = true;
              onAuthExpiredRef.current?.();
            } else {
              retryTimer = setTimeout(connect, 3000);
            }
          })
          .catch(() => {
            // Network error — retry
            retryTimer = setTimeout(connect, 3000);
          });
      };
    };

    connect();
    return () => {
      stopped = true;
      es?.close();
      clearTimeout(retryTimer);
    };
  }, [enabled, queryClient]);
}
