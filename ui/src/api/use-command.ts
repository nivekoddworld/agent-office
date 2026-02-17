import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "./client.js";
import type { CommandResponse } from "./types.js";

interface CommandArgs {
  command: string;
  args?: Record<string, unknown>;
  noWait?: boolean;
}

export function useCommand() {
  const queryClient = useQueryClient();
  return useMutation<CommandResponse, Error, CommandArgs>({
    mutationFn: ({ command, args, noWait }) => {
      const qs = noWait ? "?noWait=1" : "";
      return apiFetch<CommandResponse>(`/api/commands/${encodeURIComponent(command)}${qs}`, {
        method: "POST",
        body: args ? JSON.stringify(args) : undefined,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["state"] });
      queryClient.invalidateQueries({ queryKey: ["agent"] });
    },
  });
}
