import { useQuery } from "@tanstack/react-query";
import { apiFetch } from "./client.js";
import type { AgentDetail } from "./types.js";

export function useAgentDetail(name: string | null) {
  return useQuery<AgentDetail>({
    queryKey: ["agent", name],
    queryFn: () => apiFetch<AgentDetail>(`/api/agents/${encodeURIComponent(name!)}`),
    enabled: !!name,
    refetchInterval: 10_000,
  });
}
