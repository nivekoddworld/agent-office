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

/**
 * The picture an agent chose with set_avatar, if any. Reads the cached
 * office state without fetching it.
 */
export function useChosenAvatar(name: string): string | undefined {
  const { data } = useQuery<BootstrapState>({
    queryKey: ["state"],
    queryFn: () => apiFetch<BootstrapState>("/api/state"),
    enabled: false,
  });
  return data?.avatars?.[name];
}
