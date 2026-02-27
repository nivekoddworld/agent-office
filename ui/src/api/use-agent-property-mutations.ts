import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "./client.js";

function invalidateState(queryClient: ReturnType<typeof useQueryClient>) {
  queryClient.invalidateQueries({ queryKey: ["state"] });
  queryClient.invalidateQueries({ queryKey: ["agent"] });
}

export function useSetDescription() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      agentName,
      description,
    }: {
      agentName: string;
      description: string | null;
    }) =>
      apiFetch<{ ok: boolean }>(
        `/api/agents/${encodeURIComponent(agentName)}/description`,
        {
          method: "PATCH",
          body: JSON.stringify({ description }),
        },
      ),
    onSuccess: () => invalidateState(queryClient),
  });
}

export function useSetPriority() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      agentName,
      priority,
    }: {
      agentName: string;
      priority: string;
    }) =>
      apiFetch<{ ok: boolean }>(
        `/api/agents/${encodeURIComponent(agentName)}/priority`,
        {
          method: "PATCH",
          body: JSON.stringify({ priority }),
        },
      ),
    onSuccess: () => invalidateState(queryClient),
  });
}

export function useSetThinking() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      agentName,
      thinking,
    }: {
      agentName: string;
      thinking: string | null;
    }) =>
      apiFetch<{ ok: boolean }>(
        `/api/agents/${encodeURIComponent(agentName)}/thinking`,
        {
          method: "PATCH",
          body: JSON.stringify({ thinking }),
        },
      ),
    onSuccess: () => invalidateState(queryClient),
  });
}
