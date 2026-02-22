import { describe, it, expect, vi } from "vitest";
import {
  MESSAGE_AGENT,
  LIST_AGENTS,
  READ_AGENT_FILE,
  AUTHENTICATED_FETCH,
  MEMORY_SEARCH,
  MEMORY_GET,
  CRON_ADD,
  CRON_REMOVE,
  CRON_LIST,
  SKILL_SEARCH,
  SKILL_INSTALL,
  SKILL_REMOVE,
  SKILL_CREATE,
} from "../src/agent/tools/contracts.js";
import { createMessageAgentTool } from "../src/agent/tools/message-agent.js";
import { createListAgentsTool } from "../src/agent/tools/list-agents.js";
import { createReadAgentFileTool } from "../src/agent/tools/read-agent-file.js";
import { createAuthenticatedFetchTool } from "../src/agent/tools/authenticated-fetch.js";
import { createMemorySearchTool } from "../src/agent/tools/memory-search.js";
import { createMemoryGetTool } from "../src/agent/tools/memory-get.js";
import { createCronAddTool } from "../src/agent/tools/cron-add.js";
import { createCronRemoveTool } from "../src/agent/tools/cron-remove.js";
import { createCronListTool } from "../src/agent/tools/cron-list.js";
import { createSkillSearchTool } from "../src/agent/tools/skill-search.js";
import { createSkillInstallTool } from "../src/agent/tools/skill-install.js";
import { createSkillRemoveTool } from "../src/agent/tools/skill-remove.js";
import { createSkillCreateTool } from "../src/agent/tools/skill-create.js";
import { createMessageAgentProxy } from "../src/agent/tools/proxy/message-agent.js";
import { createListAgentsProxy } from "../src/agent/tools/proxy/list-agents.js";
import { createReadAgentFileProxy } from "../src/agent/tools/proxy/read-agent-file.js";
import { createAuthenticatedFetchProxy } from "../src/agent/tools/proxy/authenticated-fetch.js";
import { createMemorySearchProxy } from "../src/agent/tools/proxy/memory-search.js";
import { createMemoryGetProxy } from "../src/agent/tools/proxy/memory-get.js";
import { createCronAddProxy } from "../src/agent/tools/proxy/cron-add.js";
import { createCronRemoveProxy } from "../src/agent/tools/proxy/cron-remove.js";
import { createCronListProxy } from "../src/agent/tools/proxy/cron-list.js";
import { createSkillSearchProxy } from "../src/agent/tools/proxy/skill-search.js";
import { createSkillInstallProxy } from "../src/agent/tools/proxy/skill-install.js";
import { createSkillRemoveProxy } from "../src/agent/tools/proxy/skill-remove.js";
import { createSkillCreateProxy } from "../src/agent/tools/proxy/skill-create.js";
import { Priority, type AgentInfo } from "../src/types.js";

const noopFetch = vi.fn() as any;
const fakeBus = { send: vi.fn() } as any;
const fakeList = (): AgentInfo[] => [
  {
    name: "a",
    status: "idle",
    priority: Priority.NORMAL,
    model: "m",
    description: "d",
    queueDepth: 0,
    turns: 0,
    lastHeartbeat: 0,
  },
];

describe("Tool contracts — host and proxy tools share metadata", () => {
  const hostTools = [
    { contract: MESSAGE_AGENT, tool: createMessageAgentTool("self", fakeBus) },
    {
      contract: LIST_AGENTS,
      tool: createListAgentsTool("self", fakeList, "/test/base"),
    },
    { contract: READ_AGENT_FILE, tool: createReadAgentFileTool("/test/base") },
    {
      contract: AUTHENTICATED_FETCH,
      tool: createAuthenticatedFetchTool({ SECRET: "val" }),
    },
    {
      contract: MEMORY_SEARCH,
      tool: createMemorySearchTool("self", "/test/base", "auto"),
    },
    {
      contract: MEMORY_GET,
      tool: createMemoryGetTool("self", "/test/base", "auto"),
    },
    {
      contract: CRON_ADD,
      tool: createCronAddTool({
        agentName: "self",
        officeId: "test",
        officeDir: "/test/base",
        permissions: {},
        cron: null,
      }),
    },
    {
      contract: CRON_REMOVE,
      tool: createCronRemoveTool({
        agentName: "self",
        officeId: "test",
        officeDir: "/test/base",
        permissions: {},
        cron: null,
      }),
    },
    {
      contract: CRON_LIST,
      tool: createCronListTool({
        agentName: "self",
        officeId: "test",
        officeDir: "/test/base",
        permissions: {},
        cron: null,
      }),
    },
    {
      contract: SKILL_SEARCH,
      tool: createSkillSearchTool({ agentName: "self", baseDir: "/test/base" }),
    },
    {
      contract: SKILL_INSTALL,
      tool: createSkillInstallTool({
        agentName: "self",
        baseDir: "/test/base",
      }),
    },
    {
      contract: SKILL_REMOVE,
      tool: createSkillRemoveTool({ agentName: "self", baseDir: "/test/base" }),
    },
    {
      contract: SKILL_CREATE,
      tool: createSkillCreateTool({ agentName: "self", baseDir: "/test/base" }),
    },
  ];

  const proxyTools = [
    { contract: MESSAGE_AGENT, tool: createMessageAgentProxy(noopFetch) },
    { contract: LIST_AGENTS, tool: createListAgentsProxy("self", noopFetch) },
    { contract: READ_AGENT_FILE, tool: createReadAgentFileProxy(noopFetch) },
    {
      contract: AUTHENTICATED_FETCH,
      tool: createAuthenticatedFetchProxy(noopFetch),
    },
    { contract: MEMORY_SEARCH, tool: createMemorySearchProxy(noopFetch) },
    { contract: MEMORY_GET, tool: createMemoryGetProxy(noopFetch) },
    { contract: CRON_ADD, tool: createCronAddProxy(noopFetch) },
    { contract: CRON_REMOVE, tool: createCronRemoveProxy(noopFetch) },
    { contract: CRON_LIST, tool: createCronListProxy(noopFetch) },
    { contract: SKILL_SEARCH, tool: createSkillSearchProxy(noopFetch) },
    { contract: SKILL_INSTALL, tool: createSkillInstallProxy(noopFetch) },
    { contract: SKILL_REMOVE, tool: createSkillRemoveProxy(noopFetch) },
    { contract: SKILL_CREATE, tool: createSkillCreateProxy(noopFetch) },
  ];

  for (const { contract, tool } of hostTools) {
    it(`host ${contract.name}: name/label/description/parameters match contract`, () => {
      expect(tool.name).toBe(contract.name);
      expect(tool.label).toBe(contract.label);
      expect(tool.description).toBe(contract.description);
      expect(tool.parameters).toBe(contract.parameters);
    });
  }

  for (const { contract, tool } of proxyTools) {
    it(`proxy ${contract.name}: name/label/description/parameters match contract`, () => {
      expect(tool.name).toBe(contract.name);
      expect(tool.label).toBe(contract.label);
      expect(tool.description).toBe(contract.description);
      expect(tool.parameters).toBe(contract.parameters);
    });
  }
});
