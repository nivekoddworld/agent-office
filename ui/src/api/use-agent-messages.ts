import { useQuery } from "@tanstack/react-query";
import { apiFetch } from "./client.js";
import type { DmHistoryResponse } from "./types.js";

export function useAgentMessages(name: string | null) {
  return useQuery<DmHistoryResponse>({
    queryKey: ["agent-messages", name],
    queryFn: () =>
      apiFetch<DmHistoryResponse>(
        `/api/agents/${encodeURIComponent(name!)}/messages?limit=200`,
      ),
    enabled: !!name,
    staleTime: 30_000,
  });
}
