import type { HandlerContext } from "../handler-context.js";
import type { RouteDefinition } from "../router.js";
import { json, readBody, requireMutation } from "../http-helpers.js";
import { getBootstrapState } from "../routes.js";
import {
  installRegistrySkillForAgent,
  listInstalledAgentSkills,
  removeProjectSkillForAgent,
  searchRegistrySkills,
} from "../../skills/registry.js";
import { skillRemoveCommand } from "../../commands/skill.js";

export function register(ctx: HandlerContext): RouteDefinition[] {
  const { workspace, officeId, getPort, broadcast } = ctx;

  return [
    {
      method: "GET",
      pattern: /^\/api\/agents\/([^/]+)\/skills$/,
      paramNames: ["name"],
      handler: (_req, res, _url, params) => {
        const handle = workspace.getAgent(params.name!);
        if (!handle) return json(res, 404, { error: "agent_not_found" });
        const skills = listInstalledAgentSkills(
          workspace.office.dir,
          params.name!,
        );
        return json(res, 200, { agent: params.name, skills });
      },
    },
    {
      method: "GET",
      pattern: /^\/api\/agents\/([^/]+)\/skills\/search$/,
      paramNames: ["name"],
      handler: async (_req, res, url, params) => {
        const handle = workspace.getAgent(params.name!);
        if (!handle) return json(res, 404, { error: "agent_not_found" });
        const query = (url.searchParams.get("q") ?? "").trim();
        if (!query) return json(res, 200, { query: "", results: [] });
        try {
          const [results, installed] = await Promise.all([
            searchRegistrySkills(query, {
              limit: 25,
              cwd: workspace.office.dir,
            }),
            Promise.resolve(
              listInstalledAgentSkills(workspace.office.dir, params.name!),
            ),
          ]);
          const installedNames = new Set(installed.map((s) => s.name));
          const installedPackages = new Set(
            installed
              .map((s) => s.packageName)
              .filter((pkg): pkg is string => !!pkg),
          );
          return json(res, 200, {
            query,
            results: results.map((result) => ({
              ...result,
              installed:
                installedPackages.has(result.packageName) ||
                installedNames.has(result.skillName),
            })),
          });
        } catch (err) {
          return json(res, 502, {
            error: err instanceof Error ? err.message : String(err),
          });
        }
      },
    },
    {
      method: "POST",
      pattern: /^\/api\/agents\/([^/]+)\/skills\/install$/,
      paramNames: ["name"],
      handler: async (req, res, _url, params) => {
        if (requireMutation(req, res, getPort())) return;
        const handle = workspace.getAgent(params.name!);
        if (!handle) return json(res, 404, { error: "agent_not_found" });
        const body = await readBody(req);
        let parsed: { packageName?: string };
        try {
          parsed = JSON.parse(body);
        } catch {
          return json(res, 400, { error: "invalid_body" });
        }
        const packageName = parsed.packageName?.trim();
        if (!packageName)
          return json(res, 400, { error: "missing_package_name" });
        try {
          const result = await installRegistrySkillForAgent(
            workspace.office.dir,
            params.name!,
            packageName,
          );
          if (result.installed.length > 0) {
            void handle
              .steer(
                `[System] Installed skill(s) via skills.sh: ${result.installed.map((s) => s.name).join(", ")}. Skill files are under agents/${params.name}/skills.`,
              )
              .catch(() => {});
          }
          broadcast("state_changed", getBootstrapState(workspace, officeId));
          return json(res, 200, {
            ok: true,
            installed: result.installed,
            output: result.output,
          });
        } catch (err) {
          return json(res, 400, {
            ok: false,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      },
    },
    {
      method: "DELETE",
      pattern: /^\/api\/agents\/([^/]+)\/skills\/([^/]+)$/,
      paramNames: ["name", "skill"],
      handler: async (req, res, _url, params) => {
        if (requireMutation(req, res, getPort())) return;
        const name = params.name!;
        const skillName = decodeURIComponent(params.skill!);
        const handle = workspace.getAgent(name);
        if (!handle) return json(res, 404, { error: "agent_not_found" });
        try {
          let source: "project" | "legacy" = "project";
          const removal = removeProjectSkillForAgent(
            workspace.office.dir,
            name,
            skillName,
          );
          if (!removal.removed && removal.reason === "legacy") {
            await skillRemoveCommand(name, skillName, workspace);
            source = "legacy";
          } else if (!removal.removed) {
            throw new Error(`Skill "${skillName}" not found for "${name}"`);
          }
          broadcast("state_changed", getBootstrapState(workspace, officeId));
          return json(res, 200, { ok: true, source });
        } catch (err) {
          return json(res, 400, {
            ok: false,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      },
    },
  ];
}
