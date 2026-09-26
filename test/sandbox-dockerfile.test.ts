import { describe, it, expect } from "vitest";
import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, join, normalize, relative } from "node:path";

// The sandbox image copies individual files, so every module the sandbox
// entrypoint loads at runtime must be listed in src/sandbox/Dockerfile.
const SRC = join(__dirname, "..", "src");

function runtimeImports(entry: string): Set<string> {
  const seen = new Set<string>();
  const stack = [entry];
  while (stack.length) {
    const file = stack.pop()!;
    if (seen.has(file)) continue;
    seen.add(file);
    const code = readFileSync(join(SRC, file), "utf-8");
    const re = /(?:import|export)\s+(type\s+)?[^;]*?from\s+"(\.[^"]+)"/gs;
    for (const m of code.matchAll(re)) {
      if (m[1]) continue; // type-only imports are erased
      let dep = normalize(join(dirname(file), m[2]!)).replace(/\.js$/, ".ts");
      if (!existsSync(join(SRC, dep)))
        dep = join(dep.replace(/\.ts$/, ""), "index.ts");
      stack.push(dep);
    }
  }
  return seen;
}

function copiedPaths(): string[] {
  const dockerfile = readFileSync(join(SRC, "sandbox", "Dockerfile"), "utf-8");
  return dockerfile
    .split("\n")
    .filter((l) => l.startsWith("COPY "))
    .flatMap((l) => l.split(/\s+/).slice(1, -1));
}

describe("sandbox Dockerfile", () => {
  it("copies every module the sandbox entrypoint imports", () => {
    const copied = copiedPaths();
    const isCopied = (file: string) =>
      copied.some((c) => {
        const target = join(SRC, c);
        return statSync(target, { throwIfNoEntry: false })?.isDirectory()
          ? !relative(c, file).startsWith("..")
          : normalize(c) === file;
      });
    const missing = [
      ...runtimeImports("agent/entrypoints/sandbox-entry.ts"),
    ].filter((f) => !isCopied(f));
    expect(missing).toEqual([]);
  });
});
