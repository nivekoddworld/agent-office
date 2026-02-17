import { useQuery } from "@tanstack/react-query";
import { apiFetch } from "./client.js";
import type { BootstrapState } from "./types.js";

export function useBootstrapState(enabled: boolean) {
  return useQuery<BootstrapState>({
    queryKey: ["state"],
    queryFn: () => apiFetch<BootstrapState>("/api/state"),
    enabled,
    refetchInterval: false,
  });
}
