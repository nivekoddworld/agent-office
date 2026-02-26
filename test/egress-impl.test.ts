import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  messageUser,
  postChannel,
  _resetRateLimits,
} from "../src/egress/egress-impl.js";
import type { EgressContext, EgressDeps } from "../src/egress/types.js";
import { MessageBus } from "../src/transport/message-bus.js";
import {
  createMessageStore,
  type MessageStore,
} from "../src/messages/message-store.js";
import type { ChannelConfig } from "../src/types.js";

function makeDeps(overrides?: Partial<EgressDeps>): EgressDeps {
  return {
    baseDir: overrides?.baseDir ?? "/tmp",
    bus: overrides?.bus ?? new MessageBus(),
    channels: overrides?.channels ?? new Map(),
    messageStore: overrides?.messageStore,
    onStateChanged: overrides?.onStateChanged,
    now: overrides?.now,
  };
}

function makeCtx(overrides?: Partial<EgressContext>): EgressContext {
  return {
    agentName: overrides?.agentName ?? "agent-a",
    hopCount: overrides?.hopCount ?? 0,
    idempotencyKey: overrides?.idempotencyKey,
    requestId: overrides?.requestId,
    correlationId: overrides?.correlationId,
    originSession: overrides?.originSession,
  };
}

describe("egress-impl", () => {
  let dir: string;
  let store: MessageStore;

  beforeEach(() => {
    _resetRateLimits();
    dir = mkdtempSync(join(tmpdir(), "egress-"));
    store = createMessageStore(join(dir, "test.db"));
  });

  afterEach(() => {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  });

  describe("messageUser", () => {
    it("persists to SQLite", () => {
      const deps = makeDeps({ baseDir: dir, messageStore: store });
      const result = messageUser(makeCtx(), deps, "Hello user");
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.egressId).toBeDefined();
      const dms = store.queryDm("agent-a", 10);
      expect(dms).toHaveLength(1);
      expect(dms[0]!.text).toBe("Hello user");
      expect(dms[0]!.role).toBe("assistant");
    });

    it("persists to JSONL", () => {
      const deps = makeDeps({ baseDir: dir, messageStore: store });
      messageUser(makeCtx(), deps, "JSONL test");
      const jsonlPath = join(
        dir,
        "agents",
        "agent-a",
        "sessions",
        "user-dm.jsonl",
      );
      expect(existsSync(jsonlPath)).toBe(true);
      const content = readFileSync(jsonlPath, "utf-8").trim();
      const entry = JSON.parse(content);
      expect(entry.text).toBe("JSONL test");
      expect(entry.from).toBe("agent-a");
      expect(entry.egressId).toBeDefined();
    });

    it("is idempotent under retry (same idempotencyKey)", () => {
      const deps = makeDeps({ baseDir: dir, messageStore: store });
      const ctx = makeCtx({ idempotencyKey: "call-1" });
      const r1 = messageUser(ctx, deps, "first");
      const r2 = messageUser(ctx, deps, "first");
      expect(r1.ok).toBe(true);
      expect(r2.ok).toBe(true);
      if (!r1.ok || !r2.ok) return;
      expect(r1.egressId).toBe(r2.egressId);
      // SQLite should have only 1 row due to INSERT OR IGNORE
      const dms = store.queryDm("agent-a", 10);
      expect(dms).toHaveLength(1);
      // JSONL should also have only 1 line (SQLite dedup gates JSONL write)
      const jsonlPath = join(dir, "agents", "agent-a", "sessions", "user-dm.jsonl");
      const lines = readFileSync(jsonlPath, "utf-8").trim().split("\n");
      expect(lines).toHaveLength(1);
    });

    it("rejects empty message", () => {
      const deps = makeDeps({ baseDir: dir });
      const result = messageUser(makeCtx(), deps, "  ");
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.reason).toBe("validation");
    });

    it("rejects message exceeding max length", () => {
      const deps = makeDeps({ baseDir: dir });
      const long = "x".repeat(65_537);
      const result = messageUser(makeCtx(), deps, long);
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.reason).toBe("validation");
    });

    it("calls onStateChanged", () => {
      let called = false;
      const deps = makeDeps({
        baseDir: dir,
        onStateChanged: () => {
          called = true;
        },
      });
      messageUser(makeCtx(), deps, "notify");
      expect(called).toBe(true);
    });

    it("carries requestId and correlationId", () => {
      const deps = makeDeps({ baseDir: dir, messageStore: store });
      const ctx = makeCtx({
        requestId: "req-1",
        correlationId: "corr-1",
      });
      messageUser(ctx, deps, "with context");
      const dms = store.queryDm("agent-a", 10);
      expect(dms[0]!.correlation_id).toBe("corr-1");
    });

    it("works without messageStore", () => {
      const deps = makeDeps({ baseDir: dir });
      const result = messageUser(makeCtx(), deps, "no store");
      expect(result.ok).toBe(true);
    });
  });

  describe("postChannel", () => {
    const channels = new Map<string, ChannelConfig>([
      ["general", { members: ["agent-a", "agent-b", "agent-c"] }],
    ]);

    it("rejects unknown channel", () => {
      const deps = makeDeps({ baseDir: dir, channels });
      const result = postChannel(makeCtx(), deps, "nope", "hi");
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.reason).toBe("validation");
    });

    it("rejects non-member", () => {
      const deps = makeDeps({ baseDir: dir, channels });
      const ctx = makeCtx({ agentName: "outsider" });
      const result = postChannel(ctx, deps, "general", "hi");
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.reason).toBe("not_member");
    });

    it("writes JSONL to all members", () => {
      const bus = new MessageBus();
      bus.register("agent-a");
      bus.register("agent-b");
      bus.register("agent-c");
      const deps = makeDeps({ baseDir: dir, channels, bus });
      const result = postChannel(makeCtx(), deps, "general", "hello all");
      expect(result.ok).toBe(true);
      for (const member of ["agent-a", "agent-b", "agent-c"]) {
        const p = join(
          dir,
          "agents",
          member,
          "sessions",
          "channel-general.jsonl",
        );
        expect(existsSync(p)).toBe(true);
        const line = readFileSync(p, "utf-8").trim();
        const entry = JSON.parse(line);
        expect(entry.text).toBe("hello all");
        expect(entry.role).toBe("assistant");
        expect(entry.from).toBe("agent-a");
      }
    });

    it("sends bus to others (not self)", () => {
      const bus = new MessageBus();
      bus.register("agent-a");
      bus.register("agent-b");
      bus.register("agent-c");
      const deps = makeDeps({ baseDir: dir, channels, bus });
      postChannel(makeCtx(), deps, "general", "hi");
      // self (agent-a) should NOT have a bus message
      expect(bus.peek("agent-a")).toBe(0);
      // others should
      expect(bus.peek("agent-b")).toBe(1);
      expect(bus.peek("agent-c")).toBe(1);
    });

    it("respects mentions for bus targeting", () => {
      const bus = new MessageBus();
      bus.register("agent-a");
      bus.register("agent-b");
      bus.register("agent-c");
      const deps = makeDeps({ baseDir: dir, channels, bus });
      postChannel(makeCtx(), deps, "general", "hi", ["agent-b"]);
      expect(bus.peek("agent-b")).toBe(1);
      expect(bus.peek("agent-c")).toBe(0);
    });

    it("rejects when hopCount >= MAX_HOPS", () => {
      const deps = makeDeps({ baseDir: dir, channels });
      const ctx = makeCtx({ hopCount: 5 });
      const result = postChannel(ctx, deps, "general", "loop");
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.reason).toBe("hop_limit");
    });

    it("rate-limits per agent per channel", () => {
      const clock = 0;
      const bus = new MessageBus();
      bus.register("agent-a");
      bus.register("agent-b");
      bus.register("agent-c");
      const deps = makeDeps({
        baseDir: dir,
        channels,
        bus,
        now: () => clock,
      });
      const ctx = makeCtx();
      for (let i = 0; i < 5; i++) {
        const r = postChannel(ctx, deps, "general", `msg${i}`);
        expect(r.ok).toBe(true);
      }
      const r6 = postChannel(ctx, deps, "general", "too many");
      expect(r6.ok).toBe(false);
      if (r6.ok) return;
      expect(r6.reason).toBe("rate_limited");
    });

    it("allows __user__ without membership check", () => {
      const bus = new MessageBus();
      bus.register("agent-a");
      bus.register("agent-b");
      bus.register("agent-c");
      const deps = makeDeps({ baseDir: dir, channels, bus });
      const ctx = makeCtx({ agentName: "__user__" });
      const result = postChannel(ctx, deps, "general", "user msg");
      expect(result.ok).toBe(true);
    });

    it("sets role to 'user' for __user__ posts", () => {
      const bus = new MessageBus();
      bus.register("agent-a");
      bus.register("agent-b");
      bus.register("agent-c");
      const deps = makeDeps({ baseDir: dir, channels, bus });
      const ctx = makeCtx({ agentName: "__user__" });
      postChannel(ctx, deps, "general", "from user");
      const p = join(dir, "agents", "agent-a", "sessions", "channel-general.jsonl");
      const entry = JSON.parse(readFileSync(p, "utf-8").trim());
      expect(entry.role).toBe("user");
    });

    it("skips rate limit for __user__", () => {
      const bus = new MessageBus();
      bus.register("agent-a");
      bus.register("agent-b");
      bus.register("agent-c");
      const deps = makeDeps({ baseDir: dir, channels, bus });
      const ctx = makeCtx({ agentName: "__user__" });
      for (let i = 0; i < 10; i++) {
        const r = postChannel(ctx, deps, "general", `msg${i}`);
        expect(r.ok).toBe(true);
      }
    });
  });

  describe("correlation", () => {
    it("preserves correlationId end-to-end in SQLite", () => {
      const deps = makeDeps({ baseDir: dir, messageStore: store });
      const ctx = makeCtx({
        requestId: "req-x",
        correlationId: "corr-x",
      });
      messageUser(ctx, deps, "correlated");
      const dms = store.queryDm("agent-a", 10);
      expect(dms[0]!.correlation_id).toBe("corr-x");
      expect(dms[0]!.egress_id).toBeDefined();
    });
  });
});
