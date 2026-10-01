import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  messagesBefore,
  readChannelForAgent,
  readChannelLog,
} from "../src/channels/channel-history.js";
import { createReadChannelTool } from "../src/agent/tools/read-channel.js";
import type { ChannelConfig } from "../src/types.js";

let baseDir: string;
const channels = new Map<string, ChannelConfig>([
  ["general", { members: ["lead", "coder"] }],
  ["secret", { members: ["coder"] }],
]);

function writeLog(agent: string, channel: string, lines: string[]) {
  const dir = join(baseDir, "agents", agent, "sessions");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `channel-${channel}.jsonl`), lines.join("\n") + "\n");
}

beforeEach(() => {
  baseDir = mkdtempSync(join(tmpdir(), "ch-hist-"));
  writeLog("lead", "general", [
    JSON.stringify({ from: "__user__", text: "vote A or B" }),
    "not json",
    JSON.stringify({ from: "coder", text: "A" }),
    JSON.stringify({ from: "__cron__", text: "standup time" }),
  ]);
});
afterEach(() => rmSync(baseDir, { recursive: true, force: true }));

describe("channel history", () => {
  it("reads an agent's copy of the log, skipping bad lines", () => {
    expect(readChannelLog(baseDir, "lead", "general")).toHaveLength(3);
    expect(readChannelLog(baseDir, "lead", "missing")).toEqual([]);
  });

  it("read_channel returns recent messages oldest first with readable names", () => {
    const r = readChannelForAgent(baseDir, "lead", channels, "#general", 2);
    expect(r).toEqual({
      ok: true,
      text: "Last 2 message(s) in #general, oldest first:\ncoder: A\ncron: standup time",
    });
    const all = readChannelForAgent(baseDir, "lead", channels, "general");
    expect(all.ok && all.text).toContain("user: vote A or B");
  });

  it("only lets members read a channel", () => {
    const r = readChannelForAgent(baseDir, "lead", channels, "secret");
    expect(r).toEqual({
      ok: false,
      error: "You are not a member of #secret. Your channels: #general",
    });
    expect(readChannelForAgent(baseDir, "lead", channels, "nope").ok).toBe(
      false,
    );
  });

  it("clamps the limit", () => {
    const r = readChannelForAgent(baseDir, "lead", channels, "general", 0);
    expect(r.ok && r.text).toContain("Last 1 message(s)");
  });

  it("messagesBefore takes the n messages before the last matching trigger", () => {
    const log = [
      { from: "a", text: "1" },
      { from: "b", text: "go" },
      { from: "a", text: "2" },
      { from: "b", text: "go" },
    ];
    expect(messagesBefore(log, { from: "b", text: "go" }, 2)).toEqual([
      { from: "b", text: "go" },
      { from: "a", text: "2" },
    ]);
    // trigger not logged: take the tail
    expect(messagesBefore(log, { from: "x", text: "?" }, 1)).toEqual([
      { from: "b", text: "go" },
    ]);
    expect(messagesBefore(log, { from: "b", text: "go" }, 0)).toEqual([]);
  });

  it("the in-process read_channel tool uses the same rules", async () => {
    const tool = createReadChannelTool({
      agentName: "lead",
      baseDir,
      channels,
    });
    const res = await tool.execute("id", { channel: "secret" });
    expect(res.content[0]).toMatchObject({
      text: expect.stringMatching(/^Error: You are not a member of #secret/),
    });
    const ok = await tool.execute("id", { channel: "general", limit: 1 });
    expect(ok.content[0]).toMatchObject({
      text: expect.stringContaining("cron: standup time"),
    });
  });
});
