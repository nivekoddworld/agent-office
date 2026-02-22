import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "./client.js";
import type {
  AgentSkillsResponse,
  SkillSearchResponse,
  SkillInstallResponse,
  SkillRemoveResponse,
} from "./types.js";

export function useAgentSkills(agentName: string) {
  return useQuery<AgentSkillsResponse>({
    queryKey: ["agent-skills", agentName],
    queryFn: () =>
      apiFetch<AgentSkillsResponse>(
        `/api/agents/${encodeURIComponent(agentName)}/skills`,
      ),
    enabled: !!agentName,
    refetchInterval: 10_000,
  });
}

export function useSkillSearch(agentName: string, query: string) {
  const trimmed = query.trim();
  return useQuery<SkillSearchResponse>({
    queryKey: ["skills-search", agentName, trimmed],
    queryFn: () =>
      apiFetch<SkillSearchResponse>(
        `/api/agents/${encodeURIComponent(agentName)}/skills/search?q=${encodeURIComponent(trimmed)}`,
      ),
    enabled: !!agentName && trimmed.length > 0,
    staleTime: 60_000,
  });
}

function invalidateSkillQueries(queryClient: ReturnType<typeof useQueryClient>) {
  queryClient.invalidateQueries({ queryKey: ["state"] });
  queryClient.invalidateQueries({ queryKey: ["agent"] });
  queryClient.invalidateQueries({ queryKey: ["agent-skills"] });
  queryClient.invalidateQueries({ queryKey: ["skills-search"] });
}

export function useInstallSkill(agentName: string) {
  const queryClient = useQueryClient();
  return useMutation<
    SkillInstallResponse,
    Error,
    {
      packageName: string;
    }
  >({
    mutationFn: ({ packageName }) =>
      apiFetch<SkillInstallResponse>(
        `/api/agents/${encodeURIComponent(agentName)}/skills/install`,
        {
          method: "POST",
          body: JSON.stringify({ packageName }),
        },
      ),
    onSuccess: () => invalidateSkillQueries(queryClient),
  });
}

export function useRemoveSkill(agentName: string) {
  const queryClient = useQueryClient();
  return useMutation<SkillRemoveResponse, Error, { name: string }>({
    mutationFn: ({ name }) =>
      apiFetch<SkillRemoveResponse>(
        `/api/agents/${encodeURIComponent(agentName)}/skills/${encodeURIComponent(name)}`,
        {
          method: "DELETE",
        },
      ),
    onSuccess: () => invalidateSkillQueries(queryClient),
  });
}
