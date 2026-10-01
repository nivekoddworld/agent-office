import { useQuery } from "@tanstack/react-query";
import { apiFetch } from "./client.js";
import type { AgentActivityEntry } from "./types.js";

export function useAgentActivity(name: string) {
  return useQuery<{ entries: AgentActivityEntry[] }>({
    queryKey: ["agent-activity", name],
    queryFn: () =>
      apiFetch(`/api/agents/${encodeURIComponent(name)}/activity?limit=2000`),
    staleTime: 0,
  });
}
