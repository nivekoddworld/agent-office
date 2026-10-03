import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Workspace } from "../src/workspace.js";

describe("pausing the office", () => {
  const dirs: string[] = [];
  const workspace = (dir: string) =>
    new Workspace({
      office: {
        id: "t",
        name: "Test",
        env: {},
        secrets: {},
        dir,
        channels: new Map(),
        models: {},
      },
      tickIntervalMs: 50,
    });
  afterEach(() => {
    for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it("stops the scheduler, stays paused across a restart, and resumes", async () => {
    const dir = mkdtempSync(join(tmpdir(), "office-pause-"));
    dirs.push(dir);
    vi.spyOn(console, "log").mockImplementation(() => {});

    const first = workspace(dir);
    await first.start();
    const changes: boolean[] = [];
    first.scheduler.onRunningChange((r) => changes.push(r));
    expect(first.scheduler.running).toBe(true);
    expect(first.pauseAll()).toEqual([]);
    expect(first.scheduler.running).toBe(false);
    expect(first.pausedSince).toBeGreaterThan(Date.now() - 5000);
    expect(changes).toEqual([false]);
    await first.stop();

    // A restart (e.g. docker compose up --build) keeps it paused.
    const second = workspace(dir);
    await second.start();
    expect(second.scheduler.running).toBe(false);
    expect(second.pausedSince).toBeDefined();
    second.resume();
    expect(second.scheduler.running).toBe(true);
    expect(second.pausedSince).toBeUndefined();
    await second.stop();

    const third = workspace(dir);
    await third.start();
    expect(third.scheduler.running).toBe(true);
    await third.stop();
  });
});
