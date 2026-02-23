import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "./client.js";

function invalidateState(queryClient: ReturnType<typeof useQueryClient>) {
  queryClient.invalidateQueries({ queryKey: ["state"] });
  queryClient.invalidateQueries({ queryKey: ["agent"] });
}

export function useSchedulerAction() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (action: "start" | "stop") =>
      apiFetch<{ ok: boolean }>(`/api/scheduler/${action}`, { method: "POST" }),
    onSuccess: () => invalidateState(queryClient),
  });
}

export function useOfficeApply() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (force: boolean) =>
      apiFetch<{ ok: boolean }>("/api/office/apply", {
        method: "POST",
        body: JSON.stringify({ force }),
      }),
    onSuccess: () => invalidateState(queryClient),
  });
}

export function useOfficeValidate() {
  return useMutation({
    mutationFn: () => apiFetch<{ ok: boolean }>("/api/office/validate"),
  });
}

export function useHireAgent() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (args: {
      name: string;
      model?: string;
      priority?: string;
      thinking?: string;
      desc?: string;
    }) =>
      apiFetch<{ ok: boolean; name: string; cwd: string | null }>("/api/agents", {
        method: "POST",
        body: JSON.stringify(args),
      }),
    onSuccess: () => invalidateState(queryClient),
  });
}

export function useFireAgent() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (agentName: string) =>
      apiFetch<{ ok: boolean }>(`/api/agents/${encodeURIComponent(agentName)}`, {
        method: "DELETE",
      }),
    onSuccess: () => invalidateState(queryClient),
  });
}

export function useSetManager() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ agentName, manager }: { agentName: string; manager: string | null }) =>
      apiFetch<{ ok: boolean }>(
        `/api/agents/${encodeURIComponent(agentName)}/manager`,
        {
          method: "PATCH",
          body: JSON.stringify({ manager }),
        },
      ),
    onSuccess: () => invalidateState(queryClient),
  });
}

export function useCronAdd() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (args: {
      scope: "agent" | "office";
      agentName?: string;
      jobName: string;
      schedule: string;
      message: string;
      targets?: string[];
      timezone?: string;
      catchUp?: string;
    }) => {
      if (args.scope === "office") {
        return apiFetch<{ ok: boolean }>("/api/cron/office", {
          method: "POST",
          body: JSON.stringify({
            jobName: args.jobName,
            schedule: args.schedule,
            message: args.message,
            targets: args.targets,
            timezone: args.timezone,
            catchUp: args.catchUp,
          }),
        });
      }
      return apiFetch<{ ok: boolean }>(
        `/api/agents/${encodeURIComponent(args.agentName!)}/cron`,
        {
          method: "POST",
          body: JSON.stringify({
            jobName: args.jobName,
            schedule: args.schedule,
            message: args.message,
            timezone: args.timezone,
            catchUp: args.catchUp,
          }),
        },
      );
    },
    onSuccess: () => invalidateState(queryClient),
  });
}

export function useCronRemove() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      scope,
      agentName,
      jobName,
    }: {
      scope: "agent" | "office";
      agentName: string;
      jobName: string;
    }) => {
      if (scope === "office") {
        return apiFetch<{ ok: boolean }>(
          `/api/cron/office/${encodeURIComponent(jobName)}`,
          { method: "DELETE" },
        );
      }
      return apiFetch<{ ok: boolean }>(
        `/api/agents/${encodeURIComponent(agentName)}/cron/${encodeURIComponent(jobName)}`,
        { method: "DELETE" },
      );
    },
    onSuccess: () => invalidateState(queryClient),
  });
}

export function useCronToggle() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      agentName,
      jobName,
      enabled,
    }: {
      agentName: string;
      jobName: string;
      enabled: boolean;
    }) =>
      apiFetch<{ ok: boolean }>(
        `/api/agents/${encodeURIComponent(agentName)}/cron/${encodeURIComponent(jobName)}`,
        {
          method: "PATCH",
          body: JSON.stringify({ enabled }),
        },
      ),
    onSuccess: () => invalidateState(queryClient),
  });
}

export function useCronTrigger() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      scope,
      agentName,
      jobName,
    }: {
      scope: "agent" | "office";
      agentName: string;
      jobName: string;
    }) => {
      if (scope === "office") {
        return apiFetch<{ ok: boolean }>(
          `/api/cron/office/${encodeURIComponent(jobName)}/trigger`,
          { method: "POST" },
        );
      }
      return apiFetch<{ ok: boolean }>(
        `/api/agents/${encodeURIComponent(agentName)}/cron/${encodeURIComponent(jobName)}/trigger`,
        { method: "POST" },
      );
    },
    onSuccess: () => invalidateState(queryClient),
  });
}

export function useSetPrompt() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      agentName,
      action,
      text,
    }: {
      agentName: string;
      action: "set" | "append" | "clear";
      text?: string;
    }) =>
      apiFetch<{ ok: boolean }>(
        `/api/agents/${encodeURIComponent(agentName)}/prompt`,
        {
          method: "PATCH",
          body: JSON.stringify({ action, text }),
        },
      ),
    onSuccess: () => invalidateState(queryClient),
  });
}

export function useSetPermissions() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (args: {
      agentName: string;
      office_cron?: boolean;
      tools?: { mode?: "allow" | "deny"; list?: string[]; clear?: boolean };
    }) =>
      apiFetch<{ ok: boolean }>(
        `/api/agents/${encodeURIComponent(args.agentName)}/permissions`,
        {
          method: "PATCH",
          body: JSON.stringify({
            office_cron: args.office_cron,
            tools: args.tools,
          }),
        },
      ),
    onSuccess: () => invalidateState(queryClient),
  });
}

export function useSetEnv() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      agentName,
      action,
      key,
      value,
    }: {
      agentName: string;
      action: "set" | "unset";
      key: string;
      value?: string;
    }) =>
      apiFetch<{ ok: boolean }>(
        `/api/agents/${encodeURIComponent(agentName)}/env`,
        {
          method: "PATCH",
          body: JSON.stringify({ action, key, value }),
        },
      ),
    onSuccess: () => invalidateState(queryClient),
  });
}

export function useSetSecretRef() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      agentName,
      action,
      key,
      hostEnvName,
    }: {
      agentName: string;
      action: "set" | "unset";
      key: string;
      hostEnvName?: string;
    }) =>
      apiFetch<{ ok: boolean }>(
        `/api/agents/${encodeURIComponent(agentName)}/secret-refs`,
        {
          method: "PATCH",
          body: JSON.stringify({ action, key, hostEnvName }),
        },
      ),
    onSuccess: () => invalidateState(queryClient),
  });
}
