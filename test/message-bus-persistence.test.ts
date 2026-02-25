import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { MessageBus } from "../src/transport/message-bus.js";
import {
  createMessageStore,
  type MessageStore,
} from "../src/messages/message-store.js";
import { Priority } from "../src/types.js";

describe("MessageBus persistence", () => {
  let store: MessageStore;
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "buspers-"));
    store = createMessageStore(join(dir, "test.db"));
  });

  afterEach(() => {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it("persists messages to SQLite on send", () => {
    const bus = new MessageBus();
    bus.setStore(store);
    bus.register("alice");
    bus.send({
      from: "__user__",
      to: "alice",
      type: "prompt",
      payload: "hello",
      priority: Priority.NORMAL,
    });
    const persisted = store.loadInbox("alice");
    expect(persisted).toHaveLength(1);
    expect(persisted[0]!.payload).toBe("hello");
  });

  it("pop removes from both in-memory and store", () => {
    const bus = new MessageBus();
    bus.setStore(store);
    bus.register("alice");
    bus.send({
      from: "__user__",
      to: "alice",
      type: "prompt",
      payload: "task",
      priority: Priority.NORMAL,
    });
    const msg = bus.pop("alice");
    expect(msg?.payload).toBe("task");
    expect(store.loadInbox("alice")).toHaveLength(0);
    expect(bus.peek("alice")).toBe(0);
  });

  it("restores messages on re-register", () => {
    const bus1 = new MessageBus();
    bus1.setStore(store);
    bus1.register("alice");
    bus1.send({
      from: "__user__",
      to: "alice",
      type: "prompt",
      payload: "survive",
      priority: Priority.HIGH,
    });
    bus1.unregister("alice");

    // Simulate restart — new bus, same store
    const bus2 = new MessageBus();
    bus2.setStore(store);
    bus2.register("alice");
    expect(bus2.peek("alice")).toBe(1);
    const msg = bus2.pop("alice");
    expect(msg?.payload).toBe("survive");
  });

  it("purge removes all persisted data", () => {
    const bus = new MessageBus();
    bus.setStore(store);
    bus.register("alice");
    bus.send({
      from: "__user__",
      to: "alice",
      type: "prompt",
      payload: "hello",
      priority: Priority.NORMAL,
    });
    store.saveDm({
      agent: "alice",
      role: "user",
      text: "hi",
      ts_ms: 1000,
      request_id: null,
    });

    bus.purge("alice");
    expect(store.loadInbox("alice")).toHaveLength(0);
    expect(store.queryDm("alice", 10)).toHaveLength(0);
    expect(bus.peek("alice")).toBe(0);
  });

  it("pop returns highest priority first, stable FIFO within same priority", () => {
    const bus = new MessageBus();
    bus.setStore(store);
    bus.register("alice");

    bus.send({
      from: "__user__",
      to: "alice",
      type: "prompt",
      payload: "low-1",
      priority: Priority.LOW,
    });
    bus.send({
      from: "__user__",
      to: "alice",
      type: "prompt",
      payload: "high",
      priority: Priority.HIGH,
    });
    bus.send({
      from: "__user__",
      to: "alice",
      type: "prompt",
      payload: "low-2",
      priority: Priority.LOW,
    });

    expect(bus.pop("alice")?.payload).toBe("high");
    expect(bus.pop("alice")?.payload).toBe("low-1");
    expect(bus.pop("alice")?.payload).toBe("low-2");
    expect(bus.pop("alice")).toBeUndefined();
  });

  it("preserves requestId through persist+restore cycle", () => {
    const bus1 = new MessageBus();
    bus1.setStore(store);
    bus1.register("alice");
    bus1.send({
      from: "__user__",
      to: "alice",
      type: "prompt",
      payload: "req-test",
      priority: Priority.NORMAL,
      requestId: "req-42",
    });
    bus1.unregister("alice");

    const bus2 = new MessageBus();
    bus2.setStore(store);
    bus2.register("alice");
    const msg = bus2.pop("alice");
    expect(msg?.requestId).toBe("req-42");
  });

  it("rejects __broadcast__ — no messages persisted for any agent", () => {
    const bus = new MessageBus();
    bus.setStore(store);
    bus.register("alice");
    bus.register("bob");
    expect(() =>
      bus.send({
        from: "__user__",
        to: "__broadcast__",
        type: "steer",
        payload: "everyone",
        priority: Priority.NORMAL,
      }),
    ).toThrow('No inbox for agent "__broadcast__"');
    expect(store.loadInbox("alice")).toHaveLength(0);
    expect(store.loadInbox("bob")).toHaveLength(0);
  });

  it("preserves channel through persist+restore cycle", () => {
    const bus1 = new MessageBus();
    bus1.setStore(store);
    bus1.register("alice");
    bus1.send({
      from: "__user__",
      to: "alice",
      type: "prompt",
      payload: "ch-test",
      priority: Priority.NORMAL,
      sessionKey: "ch:general",
      sourceKind: "channel",
      channel: "general",
    });
    bus1.unregister("alice");

    const bus2 = new MessageBus();
    bus2.setStore(store);
    bus2.register("alice");
    const msg = bus2.pop("alice");
    expect(msg?.channel).toBe("general");
    expect(msg?.sourceKind).toBe("channel");
    expect(msg?.sessionKey).toBe("ch:general");
  });

  it("preserves channel=undefined when not set", () => {
    const bus1 = new MessageBus();
    bus1.setStore(store);
    bus1.register("bob");
    bus1.send({
      from: "__user__",
      to: "bob",
      type: "prompt",
      payload: "no-ch",
      priority: Priority.NORMAL,
    });
    bus1.unregister("bob");

    const bus2 = new MessageBus();
    bus2.setStore(store);
    bus2.register("bob");
    const msg = bus2.pop("bob");
    expect(msg?.channel).toBeUndefined();
  });

  it("works without store (no-op persistence)", () => {
    const bus = new MessageBus();
    bus.register("alice");
    bus.send({
      from: "__user__",
      to: "alice",
      type: "prompt",
      payload: "no-store",
      priority: Priority.NORMAL,
    });
    const msg = bus.pop("alice");
    expect(msg?.payload).toBe("no-store");
  });
});
