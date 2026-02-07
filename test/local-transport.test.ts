import { describe, it, expect } from "vitest";
import { LocalTransport } from "../src/transport/local.js";
import { Priority } from "../src/types.js";

describe("LocalTransport", () => {
  it("registers and unregisters mailboxes", () => {
    const t = new LocalTransport();
    t.register("a");
    expect(t.peek("a")).toBe(0);

    t.unregister("a");
    expect(t.peek("a")).toBe(0); // returns 0 for missing
  });

  it("sends and drains messages", () => {
    const t = new LocalTransport();
    t.register("a");

    t.send({ from: "b", to: "a", type: "prompt", payload: "hello", priority: Priority.NORMAL });
    expect(t.peek("a")).toBe(1);

    const msgs = t.drain("a");
    expect(msgs).toHaveLength(1);
    expect(msgs[0]!.payload).toBe("hello");
    expect(msgs[0]!.from).toBe("b");
    expect(msgs[0]!.id).toBeTruthy();
    expect(msgs[0]!.timestamp).toBeGreaterThan(0);

    // Queue is empty after drain
    expect(t.drain("a")).toHaveLength(0);
  });

  it("drains in priority order (highest first)", () => {
    const t = new LocalTransport();
    t.register("a");

    t.send({ from: "x", to: "a", type: "prompt", payload: "low", priority: Priority.LOW });
    t.send({ from: "x", to: "a", type: "prompt", payload: "critical", priority: Priority.CRITICAL });
    t.send({ from: "x", to: "a", type: "prompt", payload: "normal", priority: Priority.NORMAL });

    const msgs = t.drain("a");
    expect(msgs.map((m) => m.payload)).toEqual(["critical", "normal", "low"]);
  });

  it("broadcasts to all except sender", () => {
    const t = new LocalTransport();
    t.register("a");
    t.register("b");
    t.register("c");

    t.send({ from: "a", to: "__broadcast__", type: "prompt", payload: "hey all", priority: Priority.NORMAL });

    expect(t.peek("a")).toBe(0); // sender excluded
    expect(t.peek("b")).toBe(1);
    expect(t.peek("c")).toBe(1);

    expect(t.drain("b")[0]!.payload).toBe("hey all");
  });

  it("throws on send to unregistered agent", () => {
    const t = new LocalTransport();
    expect(() =>
      t.send({ from: "a", to: "ghost", type: "prompt", payload: "hi", priority: Priority.NORMAL }),
    ).toThrow('No mailbox for agent "ghost"');
  });

  it("push() preserves original id and timestamp", () => {
    const t = new LocalTransport();
    t.register("a");

    const msg = {
      id: "original-id",
      timestamp: 1000,
      from: "b",
      to: "a",
      type: "prompt" as const,
      payload: "requeued",
      priority: Priority.NORMAL,
    };

    t.push("a", msg);
    const drained = t.drain("a");
    expect(drained).toHaveLength(1);
    expect(drained[0]!.id).toBe("original-id");
    expect(drained[0]!.timestamp).toBe(1000);
  });

  it("push() throws for unregistered agent", () => {
    const t = new LocalTransport();
    expect(() =>
      t.push("ghost", { id: "x", timestamp: 0, from: "a", to: "ghost", type: "prompt", payload: "hi", priority: Priority.NORMAL }),
    ).toThrow('No mailbox for agent "ghost"');
  });

  it("returns empty array for unregistered drain", () => {
    const t = new LocalTransport();
    expect(t.drain("ghost")).toEqual([]);
  });
});
