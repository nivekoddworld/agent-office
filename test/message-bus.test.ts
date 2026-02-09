import { describe, it, expect } from "vitest";
import { MessageBus } from "../src/transport/message-bus.js";
import { Priority } from "../src/types.js";

describe("MessageBus", () => {
  it("registers, sends, drains, and peeks", () => {
    const bus = new MessageBus();
    bus.register("agent-a");

    bus.send({ from: "user", to: "agent-a", type: "prompt", payload: "hello", priority: Priority.NORMAL });
    expect(bus.peek("agent-a")).toBe(1);

    const msgs = bus.drain("agent-a");
    expect(msgs).toHaveLength(1);
    expect(msgs[0]!.payload).toBe("hello");
    expect(bus.peek("agent-a")).toBe(0);
  });

  it("requeues messages", () => {
    const bus = new MessageBus();
    bus.register("agent-a");

    bus.send({ from: "user", to: "agent-a", type: "prompt", payload: "first", priority: Priority.NORMAL });
    const msgs = bus.drain("agent-a");

    bus.requeue("agent-a", msgs[0]!);
    expect(bus.peek("agent-a")).toBe(1);

    const requeued = bus.drain("agent-a");
    expect(requeued[0]!.payload).toBe("first");
  });

  it("rate-limits agent sends (drops after 10)", () => {
    const bus = new MessageBus();
    bus.register("sender");
    bus.register("target");

    for (let i = 0; i < 12; i++) {
      bus.send({ from: "sender", to: "target", type: "prompt", payload: `msg-${i}`, priority: Priority.NORMAL });
    }

    // Only 10 should arrive (11th and 12th dropped)
    expect(bus.peek("target")).toBe(10);
  });

  it("does not rate-limit __user__ sends", () => {
    const bus = new MessageBus();
    bus.register("target");

    for (let i = 0; i < 15; i++) {
      bus.send({ from: "__user__", to: "target", type: "prompt", payload: `msg-${i}`, priority: Priority.NORMAL });
    }

    expect(bus.peek("target")).toBe(15);
  });

  it("does not rate-limit __cron__ sends", () => {
    const bus = new MessageBus();
    bus.register("target");

    for (let i = 0; i < 15; i++) {
      bus.send({ from: "__cron__", to: "target", type: "prompt", payload: `cron-${i}`, priority: Priority.NORMAL });
    }

    expect(bus.peek("target")).toBe(15);
  });

  it("unregisters agents", () => {
    const bus = new MessageBus();
    bus.register("agent-a");
    bus.unregister("agent-a");
    expect(bus.peek("agent-a")).toBe(0);
  });
});
