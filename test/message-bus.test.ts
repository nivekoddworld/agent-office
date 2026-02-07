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

  it("unregisters agents", () => {
    const bus = new MessageBus();
    bus.register("agent-a");
    bus.unregister("agent-a");
    expect(bus.peek("agent-a")).toBe(0);
  });
});
