import { describe, it, expect, vi } from "vitest";
import { SEND_MAIL, LIST_AGENTS, READ_AGENT_FILE, AUTHENTICATED_FETCH } from "../src/agent/tools/contracts.js";
import { createMailboxTool } from "../src/agent/tools/send-mail.js";
import { createListAgentsTool } from "../src/agent/tools/list-agents.js";
import { createReadAgentFileTool } from "../src/agent/tools/read-agent-file.js";
import { createAuthenticatedFetchTool } from "../src/agent/tools/authenticated-fetch.js";
import { createSendMailProxy } from "../src/agent/tools/proxy/send-mail.js";
import { createListAgentsProxy } from "../src/agent/tools/proxy/list-agents.js";
import { createReadAgentFileProxy } from "../src/agent/tools/proxy/read-agent-file.js";
import { createAuthenticatedFetchProxy } from "../src/agent/tools/proxy/authenticated-fetch.js";
import { Priority, type AgentInfo } from "../src/types.js";

const noopFetch = vi.fn() as any;
const fakeBus = { send: vi.fn() } as any;
const fakeList = (): AgentInfo[] => [{ name: "a", status: "idle", priority: Priority.NORMAL, model: "m", description: "d", queueDepth: 0, turns: 0, lastHeartbeat: 0 }];

describe("Tool contracts — host and proxy tools share metadata", () => {
  const hostTools = [
    { contract: SEND_MAIL, tool: createMailboxTool("self", fakeBus) },
    { contract: LIST_AGENTS, tool: createListAgentsTool("self", fakeList) },
    { contract: READ_AGENT_FILE, tool: createReadAgentFileTool() },
    { contract: AUTHENTICATED_FETCH, tool: createAuthenticatedFetchTool({ SECRET: "val" }) },
  ];

  const proxyTools = [
    { contract: SEND_MAIL, tool: createSendMailProxy(noopFetch) },
    { contract: LIST_AGENTS, tool: createListAgentsProxy("self", noopFetch) },
    { contract: READ_AGENT_FILE, tool: createReadAgentFileProxy(noopFetch) },
    { contract: AUTHENTICATED_FETCH, tool: createAuthenticatedFetchProxy(noopFetch) },
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
