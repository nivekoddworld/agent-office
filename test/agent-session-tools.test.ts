import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  createMessageStore,
  type MessageStore,
} from "../src/messages/message-store.js";
import { createSessionSearchTool } from "../src/agent/tools/session-search.js";
import { createSessionReadRangeTool } from "../src/agent/tools/session-read-range.js";
import type { ChannelConfig } from "../src/types.js";

function getText(result: any): string {
  return (result.content[0] as { text: string }).text;
}

describe("session tools", () => {
  let store: MessageStore;
  let dir: string;
  const channels: Map<string, ChannelConfig> = new Map([
    ["general", { members: ["alice", "bob"] }],
  ]);

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "session-tools-"));
    store = createMessageStore(join(dir, "test.db"));
    // Seed some data
    for (let i = 1; i <= 5; i++) {
      store.saveSession({
        session_key: "dm:alice",
        session_seq: i,
        role: i % 2 === 1 ? "user" : "assistant",
        text: `message ${i} about deployment`,
        ts_ms: i * 1000,
        request_id: null,
        agent_name: null,
      });
    }
  });

  afterEach(() => {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  });

  describe("session_search", () => {
    it("returns results for matching query", async () => {
      const tool = createSessionSearchTool("alice", store, channels);
      const result = await tool.execute("test-id", {
        query: "deployment",
      });
      expect(getText(result)).not.toContain("No results");
    });

    it("denies access to other agent's DM", async () => {
      const tool = createSessionSearchTool("bob", store, channels);
      const result = await tool.execute("test-id", {
        query: "deployment",
        sessionHint: "dm:alice",
      });
      expect(getText(result)).toContain("forbidden_session_access");
    });

    it("allows searching own DM with hint", async () => {
      const tool = createSessionSearchTool("alice", store, channels);
      const result = await tool.execute("test-id", {
        query: "deployment",
        sessionHint: "dm:alice",
      });
      expect(getText(result)).not.toContain("forbidden");
    });

    it("sessionHint filters results to specified session only", async () => {
      // Add data to ch:general
      store.saveSession({
        session_key: "ch:general",
        session_seq: 1,
        role: "user",
        text: "deployment plan for general",
        ts_ms: 6000,
        request_id: null,
        agent_name: null,
      });
      const tool = createSessionSearchTool("alice", store, channels);
      const result = await tool.execute("test-id", {
        query: "deployment",
        sessionHint: "ch:general",
      });
      const text = getText(result);
      // Should only contain ch:general results, not dm:alice
      if (text !== "No results found.") {
        expect(text).toContain("ch:general");
        expect(text).not.toContain("dm:alice");
      }
    });
  });

  describe("session_read_range", () => {
    it("reads a valid range", async () => {
      const tool = createSessionReadRangeTool("alice", store, channels);
      const result = await tool.execute("test-id", {
        sessionKey: "dm:alice",
        fromSeq: 1,
        toSeq: 3,
      });
      const text = getText(result) as string;
      expect(text).toContain("seq=1");
      expect(text).toContain("seq=2");
      expect(text).toContain("seq=3");
    });

    it("denies access to other agent's session", async () => {
      const tool = createSessionReadRangeTool("bob", store, channels);
      const result = await tool.execute("test-id", {
        sessionKey: "dm:alice",
        fromSeq: 1,
        toSeq: 3,
      });
      expect(getText(result)).toContain("forbidden_session_access");
    });

    it("rejects invalid range", async () => {
      const tool = createSessionReadRangeTool("alice", store, channels);
      const result = await tool.execute("test-id", {
        sessionKey: "dm:alice",
        fromSeq: 5,
        toSeq: 3,
      });
      expect(getText(result)).toContain("invalid range");
    });

    it("returns no messages for empty range", async () => {
      const tool = createSessionReadRangeTool("alice", store, channels);
      const result = await tool.execute("test-id", {
        sessionKey: "dm:alice",
        fromSeq: 100,
        toSeq: 105,
      });
      expect(getText(result)).toContain("No messages");
    });
  });
});
