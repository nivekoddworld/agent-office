import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "./client.js";
import type { CronTaskTemplate, Task, TaskCreateBody } from "./types.js";

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
      apiFetch<{ ok: boolean; name: string; cwd: string | null; warning?: string }>(
        "/api/agents",
        {
          method: "POST",
          body: JSON.stringify(args),
        },
      ),
    onSuccess: () => invalidateState(queryClient),
  });
}

export function useFireAgent() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (agentName: string) =>
      apiFetch<{ ok: boolean }>(
        `/api/agents/${encodeURIComponent(agentName)}`,
        {
          method: "DELETE",
        },
      ),
    onSuccess: () => invalidateState(queryClient),
  });
}

export function useSetManager() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      agentName,
      manager,
    }: {
      agentName: string;
      manager: string | null;
    }) =>
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
      jobName: string;
      schedule: string;
      tasks: CronTaskTemplate[];
      timezone?: string;
      catchUp?: string;
      reportChannel?: string;
    }) =>
      apiFetch<{ ok: boolean }>("/api/cron", {
        method: "POST",
        body: JSON.stringify({
          jobName: args.jobName,
          schedule: args.schedule,
          tasks: args.tasks,
          timezone: args.timezone,
          catchUp: args.catchUp,
          reportChannel: args.reportChannel || undefined,
        }),
      }),
    onSuccess: () => invalidateState(queryClient),
  });
}

export function useCronRemove() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ jobName }: { jobName: string }) =>
      apiFetch<{ ok: boolean }>(`/api/cron/${encodeURIComponent(jobName)}`, {
        method: "DELETE",
      }),
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
    mutationFn: ({ jobName }: { jobName: string }) =>
      apiFetch<{ ok: boolean }>(
        `/api/cron/${encodeURIComponent(jobName)}/trigger`,
        { method: "POST" },
      ),
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
      action: "set" | "append" | "clear" | "import-instructions";
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

export function useTaskCreate() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: TaskCreateBody) =>
      apiFetch<Task>("/api/tasks", {
        method: "POST",
        body: JSON.stringify(body),
      }),
    onSuccess: () => invalidateState(queryClient),
  });
}

export function useTaskUpdate() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      taskId,
      ...body
    }: {
      taskId: string;
      status?: string;
      result?: string;
      assignee?: string;
      priority?: string;
    }) =>
      apiFetch<Task>(`/api/tasks/${encodeURIComponent(taskId)}`, {
        method: "PATCH",
        body: JSON.stringify(body),
      }),
    onSuccess: () => invalidateState(queryClient),
  });
}

export function useTaskDelete() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (taskId: string) =>
      apiFetch<Task>(`/api/tasks/${encodeURIComponent(taskId)}`, {
        method: "DELETE",
      }),
    onSuccess: () => invalidateState(queryClient),
  });
}

export function useHeartbeatSet() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (args: {
      agentName: string;
      intervalMs: number;
      prompt?: string;
      activeHours?: { start: string; end: string };
    }) =>
      apiFetch<{ ok: boolean }>(
        `/api/agents/${encodeURIComponent(args.agentName)}/heartbeat`,
        {
          method: "PATCH",
          body: JSON.stringify({
            interval_ms: args.intervalMs,
            ...(args.prompt ? { prompt: args.prompt } : {}),
            ...(args.activeHours ? { active_hours: args.activeHours } : {}),
          }),
        },
      ),
    onSuccess: () => invalidateState(queryClient),
  });
}

export function useHeartbeatClear() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ agentName }: { agentName: string }) =>
      apiFetch<{ ok: boolean }>(
        `/api/agents/${encodeURIComponent(agentName)}/heartbeat`,
        { method: "DELETE" },
      ),
    onSuccess: () => invalidateState(queryClient),
  });
}

export function useSetModel() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      agentName,
      model,
    }: {
      agentName: string;
      model: string;
    }) =>
      apiFetch<{ ok: boolean; warning?: string }>(
        `/api/agents/${encodeURIComponent(agentName)}/model`,
        {
          method: "PATCH",
          body: JSON.stringify({ model }),
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

export function useSaveInstructionFile() {
  return useMutation({
    mutationFn: ({
      agentName,
      file,
      content,
    }: {
      agentName: string;
      file: string;
      content: string;
    }) =>
      apiFetch<{ ok: true }>(
        `/api/agents/${encodeURIComponent(agentName)}/instructions/${encodeURIComponent(file)}`,
        {
          method: "PUT",
          body: JSON.stringify({ content }),
        },
      ),
  });
}

export function useSetAuth() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      agentName,
      auth,
    }: {
      agentName: string;
      auth: string | null;
    }) =>
      apiFetch<{ ok: boolean }>(
        `/api/agents/${encodeURIComponent(agentName)}/auth`,
        {
          method: "PATCH",
          body: JSON.stringify({ auth }),
        },
      ),
    onSuccess: () => invalidateState(queryClient),
  });
}

export function useOAuthDelete() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ provider }: { provider: string }) =>
      apiFetch<{ ok: boolean }>(
        `/api/oauth/${encodeURIComponent(provider)}`,
        { method: "DELETE" },
      ),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["oauth-providers"] });
      invalidateState(queryClient);
    },
  });
}
