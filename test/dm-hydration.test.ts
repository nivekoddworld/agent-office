import { describe, it, expect } from "vitest";
import { mergeBaselineWithLive } from "../ui/src/components/slack/channel-helpers.js";
import type { SlackMessageData } from "../ui/src/components/slack/types.js";

function msg(
  overrides: Partial<SlackMessageData> & { id: string },
): SlackMessageData {
  return {
    sender: "bot",
    text: "hello",
    timestamp: 1000,
    isBot: true,
    ...overrides,
  };
}

describe("mergeBaselineWithLive", () => {
  it("returns baseline only when no live messages", () => {
    const baseline = [msg({ id: "b1", timestamp: 100 })];
    const result = mergeBaselineWithLive(baseline, []);
    expect(result).toHaveLength(1);
    expect(result[0]!.id).toBe("b1");
  });

  it("returns live only when no baseline", () => {
    const live = [msg({ id: "l1", timestamp: 200 })];
    const result = mergeBaselineWithLive([], live);
    expect(result).toHaveLength(1);
    expect(result[0]!.id).toBe("l1");
  });

  it("deduplicates by requestId", () => {
    const baseline = [msg({ id: "b1", timestamp: 100, requestId: "r1" })];
    const live = [msg({ id: "l1", timestamp: 100, requestId: "r1" })];
    const result = mergeBaselineWithLive(baseline, live);
    expect(result).toHaveLength(1);
    expect(result[0]!.id).toBe("l1");
  });

  it("deduplicates by fingerprint within time window", () => {
    const baseline = [
      msg({ id: "b1", text: "hello", timestamp: 1000, isBot: true }),
    ];
    const live = [
      msg({ id: "l1", text: "hello", timestamp: 1500, isBot: true }),
    ];
    const result = mergeBaselineWithLive(baseline, live);
    expect(result).toHaveLength(1);
    expect(result[0]!.id).toBe("l1");
  });

  it("keeps both when fingerprints differ", () => {
    const baseline = [msg({ id: "b1", text: "hello", timestamp: 1000 })];
    const live = [msg({ id: "l1", text: "world", timestamp: 1500 })];
    const result = mergeBaselineWithLive(baseline, live);
    expect(result).toHaveLength(2);
  });

  it("keeps both when timestamps outside window", () => {
    const baseline = [
      msg({ id: "b1", text: "hello", timestamp: 1000, isBot: true }),
    ];
    const live = [
      msg({ id: "l1", text: "hello", timestamp: 5000, isBot: true }),
    ];
    const result = mergeBaselineWithLive(baseline, live);
    expect(result).toHaveLength(2);
  });

  it("sorts merged output by timestamp", () => {
    const baseline = [msg({ id: "b1", text: "old", timestamp: 100 })];
    const live = [msg({ id: "l1", text: "new", timestamp: 200 })];
    const result = mergeBaselineWithLive(baseline, live);
    expect(result[0]!.id).toBe("b1");
    expect(result[1]!.id).toBe("l1");
  });

  it("handles repeated identical user texts with different requestIds", () => {
    const baseline = [
      msg({
        id: "b1",
        sender: "You",
        text: "run tests",
        timestamp: 1000,
        isBot: false,
        requestId: "r1",
      }),
      msg({
        id: "b2",
        sender: "You",
        text: "run tests",
        timestamp: 2000,
        isBot: false,
        requestId: "r2",
      }),
    ];
    const live = [
      msg({
        id: "l1",
        sender: "You",
        text: "run tests",
        timestamp: 3000,
        isBot: false,
        requestId: "r3",
      }),
    ];
    const result = mergeBaselineWithLive(baseline, live);
    // All three have distinct requestIds — no fingerprint dedup applied
    expect(result).toHaveLength(3);
    expect(result.map((m) => m.id)).toEqual(["b1", "b2", "l1"]);
  });

  it("differentiates user vs assistant with same text", () => {
    const baseline = [
      msg({ id: "b1", text: "hello", timestamp: 1000, isBot: false }),
    ];
    const live = [
      msg({ id: "l1", text: "hello", timestamp: 1000, isBot: true }),
    ];
    const result = mergeBaselineWithLive(baseline, live);
    expect(result).toHaveLength(2);
  });

  it("deduplicates baseline without requestId against live without requestId", () => {
    const baseline = [
      msg({ id: "b1", text: "hello", timestamp: 1000, isBot: true }),
    ];
    const live = [
      msg({ id: "l1", text: "hello", timestamp: 1500, isBot: true }),
    ];
    const result = mergeBaselineWithLive(baseline, live);
    // Both lack requestId, fingerprint match within window → dedup
    expect(result).toHaveLength(1);
    expect(result[0]!.id).toBe("l1");
  });

  it("keeps baseline with requestId even when live fingerprint matches", () => {
    const baseline = [
      msg({
        id: "b1",
        text: "hello",
        timestamp: 1000,
        isBot: true,
        requestId: "r1",
      }),
    ];
    const live = [
      msg({ id: "l1", text: "hello", timestamp: 1500, isBot: true }),
    ];
    const result = mergeBaselineWithLive(baseline, live);
    // b1 has requestId, l1 doesn't — no requestId match and no fingerprint
    // fallback (b1 has requestId so fingerprint path is skipped)
    expect(result).toHaveLength(2);
  });

  it("dedupes baseline against thread parent by requestId", () => {
    const baseline = [
      msg({
        id: "b1",
        sender: "You",
        text: "fix bug",
        timestamp: 5000,
        isBot: false,
        requestId: "r1",
      }),
    ];
    const live: SlackMessageData[] = [];
    const threadParents = [
      msg({
        id: "tp1",
        sender: "You",
        text: "fix bug",
        timestamp: 5010,
        isBot: false,
        requestId: "r1",
      }),
    ];
    const result = mergeBaselineWithLive(baseline, live, threadParents);
    expect(result).toHaveLength(0);
  });

  it("thread parents do not appear in merge output", () => {
    const baseline = [msg({ id: "b1", text: "old", timestamp: 100 })];
    const live = [msg({ id: "l1", text: "new", timestamp: 200 })];
    const threadParents = [
      msg({ id: "tp1", text: "parent", timestamp: 150, requestId: "r99" }),
    ];
    const result = mergeBaselineWithLive(baseline, live, threadParents);
    expect(result.find((m) => m.id === "tp1")).toBeUndefined();
    expect(result).toHaveLength(2);
  });

  it("handles empty inputs", () => {
    expect(mergeBaselineWithLive([], [])).toEqual([]);
  });
});
