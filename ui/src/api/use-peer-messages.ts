import { useQuery } from "@tanstack/react-query";
import { apiFetch } from "./client.js";
import type { PeerListResponse, PeerMessagesResponse } from "./types.js";

export function useAgentPeers(agentName: string | null) {
  return useQuery<PeerListResponse>({
    queryKey: ["agent-peers", agentName],
    queryFn: () =>
      apiFetch<PeerListResponse>(
        `/api/agents/${encodeURIComponent(agentName!)}/peers`,
      ),
    enabled: !!agentName,
    staleTime: 30_000,
  });
}

export function usePeerMessages(
  agentName: string | null,
  peer: string | null,
) {
  return useQuery<PeerMessagesResponse>({
    queryKey: ["peer-messages", agentName, peer],
    queryFn: () =>
      apiFetch<PeerMessagesResponse>(
        `/api/agents/${encodeURIComponent(agentName!)}/peers/${encodeURIComponent(peer!)}/messages?limit=200`,
      ),
    enabled: !!agentName && !!peer,
    staleTime: 15_000,
  });
}
