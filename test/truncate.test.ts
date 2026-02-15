import { describe, it, expect } from "vitest";
import {
  truncateText,
  truncateBlocks,
  type BlockContent,
} from "../src/agent/prompts/truncate.js";

describe("truncateText", () => {
  it("returns text unchanged when under limit", () => {
    const text = "Hello, world!";
    expect(truncateText(text, 100)).toBe(text);
  });

  it("truncates long text with head/tail split and marker", () => {
    const text = "A".repeat(200);
    const result = truncateText(text, 100);
    expect(result.length).toBeLessThanOrEqual(100);
    expect(result).toContain("[...truncated...]");
    expect(result.startsWith("A")).toBe(true);
    expect(result.endsWith("A")).toBe(true);
  });

  it("preserves head ratio > tail ratio", () => {
    const text = "H".repeat(50) + "T".repeat(50);
    const result = truncateText(text, 50);
    const markerIdx = result.indexOf("[...truncated...]");
    const head = result.slice(0, markerIdx);
    const tail = result.slice(markerIdx + "[...truncated...]".length);
    // head should be longer than tail (0.7 vs 0.2 ratio)
    expect(head.length).toBeGreaterThan(tail.length);
  });

  it("is deterministic", () => {
    const text = "X".repeat(500);
    expect(truncateText(text, 100)).toBe(truncateText(text, 100));
  });

  it("handles edge case where maxChars is very small", () => {
    const text = "A".repeat(100);
    const result = truncateText(text, 5);
    expect(result.length).toBeLessThanOrEqual(5);
  });
});

describe("truncateBlocks", () => {
  it("returns blocks unchanged when under limits", () => {
    const blocks: BlockContent[] = [
      { name: "base", text: "Base prompt" },
      { name: "identity", text: "You are agent X" },
    ];
    const { blocks: result, meta } = truncateBlocks(blocks);
    expect(result).toEqual(blocks);
    expect(meta).toEqual([
      { name: "base", chars: 11 },
      { name: "identity", chars: 15 },
    ]);
  });

  it("enforces per-block limits", () => {
    const blocks: BlockContent[] = [
      { name: "office", text: "X".repeat(10_000) },
    ];
    const { blocks: result } = truncateBlocks(blocks);
    // office limit is 5000
    expect(result[0]!.text.length).toBeLessThanOrEqual(5_000);
    expect(result[0]!.text).toContain("[...truncated...]");
  });

  it("enforces total limit via proportional reduction", () => {
    const blocks: BlockContent[] = [
      { name: "base", text: "A".repeat(60_000) },
      { name: "custom", text: "B".repeat(60_000) },
    ];
    const { blocks: result } = truncateBlocks(blocks);
    const total = result.reduce((sum, b) => sum + b.text.length, 0);
    expect(total).toBeLessThanOrEqual(100_000);
  });

  it("preserves block order", () => {
    const blocks: BlockContent[] = [
      { name: "base", text: "first" },
      { name: "office", text: "second" },
      { name: "identity", text: "third" },
    ];
    const { blocks: result } = truncateBlocks(blocks);
    expect(result.map((b) => b.name)).toEqual([
      "base",
      "office",
      "identity",
    ]);
  });

  it("produces deterministic output", () => {
    const blocks: BlockContent[] = [
      { name: "base", text: "A".repeat(50_000) },
      { name: "custom", text: "B".repeat(50_000) },
    ];
    const a = truncateBlocks(blocks);
    const b = truncateBlocks(blocks);
    expect(a.meta).toEqual(b.meta);
  });

  it("includes skills block in truncation scope", () => {
    const blocks: BlockContent[] = [
      { name: "skills", text: "S".repeat(40_000) },
    ];
    const { blocks: result } = truncateBlocks(blocks);
    // skills limit is 30000
    expect(result[0]!.text.length).toBeLessThanOrEqual(30_000);
  });

  it("respects custom per-block limits", () => {
    const blocks: BlockContent[] = [
      { name: "base", text: "A".repeat(200) },
    ];
    const { blocks: result } = truncateBlocks(blocks, {
      perBlockLimits: { base: 50 },
    });
    expect(result[0]!.text.length).toBeLessThanOrEqual(50);
  });

  it("respects custom total limit", () => {
    const blocks: BlockContent[] = [
      { name: "base", text: "A".repeat(500) },
      { name: "custom", text: "B".repeat(500) },
    ];
    const { blocks: result } = truncateBlocks(blocks, {
      maxTotalChars: 200,
    });
    const total = result.reduce((sum, b) => sum + b.text.length, 0);
    expect(total).toBeLessThanOrEqual(200);
  });
});
