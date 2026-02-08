import { describe, it, expect } from "vitest";
import { Command, Option } from "commander";

/** Build a minimal command with the same --sandbox option as src/index.ts */
function buildCommand(): Command {
  return new Command()
    .exitOverride() // throw instead of process.exit
    .configureOutput({ writeErr: () => {} }) // suppress stderr
    .addOption(new Option("--sandbox <mode>", "Sandbox mode").choices(["none", "docker"]).default("none"))
    .action(() => {});
}

describe("--sandbox CLI validation", () => {
  it("accepts 'none'", () => {
    const cmd = buildCommand();
    cmd.parse(["node", "test", "--sandbox", "none"]);
    expect(cmd.opts().sandbox).toBe("none");
  });

  it("accepts 'docker'", () => {
    const cmd = buildCommand();
    cmd.parse(["node", "test", "--sandbox", "docker"]);
    expect(cmd.opts().sandbox).toBe("docker");
  });

  it("rejects invalid mode", () => {
    const cmd = buildCommand();
    expect(() => cmd.parse(["node", "test", "--sandbox", "foobar"])).toThrow();
  });

  it("defaults to 'none'", () => {
    const cmd = buildCommand();
    cmd.parse(["node", "test"]);
    expect(cmd.opts().sandbox).toBe("none");
  });
});
