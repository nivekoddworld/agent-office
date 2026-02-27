import { describe, it, expect } from "vitest";
import { resolveCustomPrompt } from "../src/agent/prompts/prompt-loader.js";

describe("resolveCustomPrompt", () => {
  it("returns inline text directly", () => {
    const result = resolveCustomPrompt(
      { prompt_inline: "You are a coder." },
      "/unused",
    );
    expect(result).toBe("You are a coder.");
  });

  it("returns undefined when not set", () => {
    expect(resolveCustomPrompt({}, "/unused")).toBeUndefined();
  });
});
