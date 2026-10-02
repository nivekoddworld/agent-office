import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { dmPartners, readDmForAgent } from "../src/channels/dm-history.js";
import { createReadDmTool } from "../src/agent/tools/read-dm.js";

let baseDir: string;

function writeLog(agent: string, file: string, lines: object[]) {
  const dir = join(baseDir, "agents", agent, "sessions");
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, file),
    lines.map((l) => JSON.stringify(l)).join("\n") + "\n",
  );
}

beforeEach(() => {
  baseDir = mkdtempSync(join(tmpdir(), "dm-hist-"));
  writeLog("coder", "user-dm.jsonl", [
    { role: "user", from: "__user__", text: "zip up the latest build" },
    { role: "assistant", from: "coder", text: "On it" },
    { role: "user", from: "__user__", text: "and send it to me" },
  ]);
  writeLog("coder", "agent-lead.jsonl", [
    { role: "user", from: "lead", text: "status?" },
    { role: "user", from: "coder", text: "building" },
  ]);
});
afterEach(() => rmSync(baseDir, { recursive: true, force: true }));

describe("read_dm", () => {
  it("reads the DM with the user by default, oldest first", () => {
    const r = readDmForAgent(baseDir, "coder", undefined);
    expect(r).toEqual({
      ok: true,
      text: "Last 3 direct message(s) between you and the user, oldest first:\nuser: zip up the latest build\ncoder: On it\nuser: and send it to me",
    });
    const last = readDmForAgent(baseDir, "coder", "user", 1);
    expect(last.ok && last.text).toMatch(/Last 1 .*\nuser: and send it to me$/);
  });

  it("reads a DM with another agent", () => {
    const r = readDmForAgent(baseDir, "coder", "@lead");
    expect(r.ok && r.text).toContain("lead: status?\ncoder: building");
  });

  it("lists who it has DMs with when there are none with that name", () => {
    expect(dmPartners(baseDir, "coder")).toEqual(["user", "lead"]);
    const r = readDmForAgent(baseDir, "coder", "artist");
    expect(r.ok && r.text).toBe(
      "No direct messages with artist yet. You have DMs with: user, lead",
    );
  });

  it("refuses names that aren't agent names", () => {
    const r = readDmForAgent(baseDir, "coder", "../lead/user-dm");
    expect(r.ok).toBe(false);
  });

  it("works as an in-process tool", async () => {
    const tool = createReadDmTool({ agentName: "coder", baseDir });
    const res = await tool.execute("t1", { with: "lead" });
    const text = (res.content[0] as { text: string }).text;
    expect(text).toContain("lead: status?");
  });
});
