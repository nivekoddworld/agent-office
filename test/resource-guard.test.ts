import { describe, it, expect } from "vitest";
import { MutexGuard, SemaphoreGuard } from "../src/scheduler/resource-guard.js";

describe("MutexGuard", () => {
  it("acquires and releases a lock", async () => {
    const guard = new MutexGuard();

    const release = await guard.acquire("db", "agent-a");
    expect(guard.getHolder("db")).toBe("agent-a");
    expect(guard.listLocked()).toEqual([{ resource: "db", holder: "agent-a" }]);

    release();
    expect(guard.getHolder("db")).toBeUndefined();
    expect(guard.listLocked()).toEqual([]);
  });

  it("blocks second acquire until first releases", async () => {
    const guard = new MutexGuard();
    const order: string[] = [];

    const release1 = await guard.acquire("db", "a");
    order.push("a-acquired");

    const p2 = guard.acquire("db", "b").then((release) => {
      order.push("b-acquired");
      release();
    });

    // b should not have acquired yet
    await new Promise((r) => setTimeout(r, 50));
    expect(order).toEqual(["a-acquired"]);

    release1();
    await p2;
    expect(order).toEqual(["a-acquired", "b-acquired"]);
  });

  it("returns undefined holder for unknown resource", () => {
    const guard = new MutexGuard();
    expect(guard.getHolder("unknown")).toBeUndefined();
  });
});

describe("SemaphoreGuard", () => {
  it("creates and acquires within limit", async () => {
    const guard = new SemaphoreGuard();
    guard.create("api", 2);

    const r1 = await guard.acquire("api");
    const r2 = await guard.acquire("api");

    expect(guard.status()).toEqual([{ resource: "api", used: 2, max: 2 }]);

    r1();
    expect(guard.status()[0]!.used).toBe(1);
    r2();
    expect(guard.status()[0]!.used).toBe(0);
  });

  it("blocks when at capacity", async () => {
    const guard = new SemaphoreGuard();
    guard.create("api", 1);

    const r1 = await guard.acquire("api");
    let acquired = false;

    const p = guard.acquire("api").then((release) => {
      acquired = true;
      release();
    });

    await new Promise((r) => setTimeout(r, 50));
    expect(acquired).toBe(false);

    r1();
    await p;
    expect(acquired).toBe(true);
  });

  it("throws on acquire for uncreated semaphore", async () => {
    const guard = new SemaphoreGuard();
    await expect(guard.acquire("missing")).rejects.toThrow('Semaphore "missing" not created');
  });

  it("does not re-create existing semaphore", () => {
    const guard = new SemaphoreGuard();
    guard.create("api", 3);
    guard.create("api", 10); // should be ignored
    expect(guard.status()[0]!.max).toBe(3);
  });
});
