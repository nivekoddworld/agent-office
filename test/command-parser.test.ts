import { describe, it, expect } from "vitest";
import { parseReplInput } from "../src/ui/command-parser.js";

describe("parseReplInput", () => {
  it("splits simple tokens on spaces", () => {
    expect(parseReplInput("roster")).toEqual(["roster"]);
    expect(parseReplInput("send alice hello")).toEqual([
      "send",
      "alice",
      "hello",
    ]);
  });

  it("handles double-quoted strings as single tokens", () => {
    expect(
      parseReplInput('cron add bot daily "0 9 * * 1-5" Run standup'),
    ).toEqual(["cron", "add", "bot", "daily", "0 9 * * 1-5", "Run", "standup"]);
  });

  it("handles single-quoted strings as single tokens", () => {
    expect(parseReplInput("agent prompt set bot 'hello world'")).toEqual([
      "agent",
      "prompt",
      "set",
      "bot",
      "hello world",
    ]);
  });

  it("decodes escaped double-quotes inside quoted strings", () => {
    expect(parseReplInput('agent prompt set bot "say \\"hi\\""')).toEqual([
      "agent",
      "prompt",
      "set",
      "bot",
      'say "hi"',
    ]);
  });

  it("decodes escaped single-quotes inside single-quoted strings", () => {
    expect(parseReplInput("agent prompt set bot 'say \\'hi\\''")).toEqual([
      "agent",
      "prompt",
      "set",
      "bot",
      "say 'hi'",
    ]);
  });

  it("decodes escaped backslashes inside quoted strings", () => {
    expect(parseReplInput('agent prompt set bot "path\\\\to\\\\file"')).toEqual(
      ["agent", "prompt", "set", "bot", "path\\to\\file"],
    );
  });

  it("handles mixed escaped quotes and backslashes", () => {
    expect(parseReplInput('agent prompt set bot "a\\\\\\"b"')).toEqual([
      "agent",
      "prompt",
      "set",
      "bot",
      'a\\"b',
    ]);
  });

  it("treats non-special backslash as literal", () => {
    expect(parseReplInput('agent prompt set bot "hello\\nworld"')).toEqual([
      "agent",
      "prompt",
      "set",
      "bot",
      "hello\\nworld",
    ]);
  });

  it("returns empty array for empty input", () => {
    expect(parseReplInput("")).toEqual([]);
    expect(parseReplInput("   ")).toEqual([]);
  });

  it("collapses multiple spaces between tokens", () => {
    expect(parseReplInput("send   alice   hello")).toEqual([
      "send",
      "alice",
      "hello",
    ]);
  });

  it("preserves backward compat for cron schedule quoting", () => {
    expect(
      parseReplInput('cron add alice daily "0 9 * * *" hello world'),
    ).toEqual(["cron", "add", "alice", "daily", "0 9 * * *", "hello", "world"]);
  });

  it("preserves backward compat for office reload --force", () => {
    expect(parseReplInput("office reload --force")).toEqual([
      "office",
      "reload",
      "--force",
    ]);
  });

  it("preserves literal newlines in unquoted text", () => {
    expect(parseReplInput("send alice line1\nline2")).toEqual([
      "send",
      "alice",
      "line1\nline2",
    ]);
  });

  it("preserves literal newlines inside quoted strings", () => {
    expect(parseReplInput('agent prompt set bot "line1\nline2"')).toEqual([
      "agent",
      "prompt",
      "set",
      "bot",
      "line1\nline2",
    ]);
  });
});
