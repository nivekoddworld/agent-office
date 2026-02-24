import { useQuery } from "@tanstack/react-query";
import { apiFetch } from "./client.js";
import type { ModelsResponse } from "./types.js";

export function useModels() {
  return useQuery<ModelsResponse>({
    queryKey: ["models"],
    queryFn: () => apiFetch<ModelsResponse>("/api/models"),
    staleTime: 5 * 60 * 1000,
  });
}
