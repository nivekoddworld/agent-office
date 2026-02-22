import { useQuery } from "@tanstack/react-query";
import { apiFetch } from "./client.js";
import type { ChannelHistoryResponse } from "./types.js";

export function useChannelMessages(name: string | null) {
  return useQuery<ChannelHistoryResponse>({
    queryKey: ["channel-messages", name],
    queryFn: () =>
      apiFetch<ChannelHistoryResponse>(
        `/api/channels/${encodeURIComponent(name!)}/messages?limit=200`,
      ),
    enabled: !!name,
    staleTime: 30_000,
  });
}
