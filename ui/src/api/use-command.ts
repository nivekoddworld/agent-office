import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiFetch, ApiError } from "./client.js";
import type { CommandResponse } from "./types.js";

interface CommandArgs {
  command: string;
  args?: Record<string, unknown>;
  noWait?: boolean;
}

async function sendCommand({
  command,
  args,
  noWait,
}: CommandArgs): Promise<CommandResponse> {
  try {
    return await apiFetch<CommandResponse>("/api/commands", {
      method: "POST",
      body: JSON.stringify({ command, noWait: noWait || undefined }),
    });
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) {
      const qs = noWait ? "?noWait=1" : "";
      return apiFetch<CommandResponse>(
        `/api/commands/${encodeURIComponent(command)}${qs}`,
        { method: "POST", body: args ? JSON.stringify(args) : undefined },
      );
    }
    throw err;
  }
}

export function useCommand() {
  const queryClient = useQueryClient();
  return useMutation<CommandResponse, Error, CommandArgs>({
    mutationFn: sendCommand,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["state"] });
      queryClient.invalidateQueries({ queryKey: ["agent"] });
    },
  });
}
