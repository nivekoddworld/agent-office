import { describe, it, expect } from "vitest";
import { Command } from "commander";

/** Build a minimal command with the same --no-ui option as src/index.ts */
function buildCommand(): Command {
  return new Command()
    .exitOverride()
    .configureOutput({ writeErr: () => {} })
    .option("--no-ui", "Run headless without the web UI")
    .action(() => {});
}

describe("--no-ui CLI validation", () => {
  it("defaults to ui=true when --no-ui is absent", () => {
    const cmd = buildCommand();
    cmd.parse(["node", "test"]);
    expect(cmd.opts().ui).toBe(true);
  });

  it("sets ui=false when --no-ui is passed", () => {
    const cmd = buildCommand();
    cmd.parse(["node", "test", "--no-ui"]);
    expect(cmd.opts().ui).toBe(false);
  });
});
