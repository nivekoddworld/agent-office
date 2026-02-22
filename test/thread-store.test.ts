import { describe, it, expect } from "vitest";
import { createThreadStore } from "../ui/src/store/thread-store.js";

function msg(id: string, sender: string, text: string) {
  return {
    id,
    sender,
    text,
    timestamp: Date.now(),
    isBot: sender !== "You",
  };
}

describe("thread store request correlation", () => {
  it("routes replies by requestId when same agent has parallel threads", () => {
    const store = createThreadStore();
    const t1 = store.createThread("coder", msg("u1", "You", "first"), "req-1");
    const t2 = store.createThread("coder", msg("u2", "You", "second"), "req-2");

    store.addReply("coder", msg("a1", "coder", "reply first"), "req-1");
    store.addReply("coder", msg("a2", "coder", "reply second"), "req-2");

    const state = store.getSnapshot();
    const thread1 = state.threads.find((t) => t.id === t1)!;
    const thread2 = state.threads.find((t) => t.id === t2)!;
    expect(thread1.replies.map((r) => r.text)).toEqual(["reply first"]);
    expect(thread2.replies.map((r) => r.text)).toEqual(["reply second"]);

    store.completeThread("coder", "req-1");
    const next = store.getSnapshot();
    expect(next.threads.find((t) => t.id === t1)?.status).toBe("completed");
    expect(next.threads.find((t) => t.id === t2)?.status).toBe("open");
    expect(next.activeThreadByContextAgent["dm:coder::coder"]).toBe(t2);
  });

  it("falls back to active agent mapping when requestId is missing", () => {
    const store = createThreadStore();
    store.createThread("coder", msg("u1", "You", "first"));
    const latest = store.createThread("coder", msg("u2", "You", "second"));

    store.addReply("coder", msg("a1", "coder", "latest reply"));

    const state = store.getSnapshot();
    const latestThread = state.threads.find((t) => t.id === latest)!;
    expect(latestThread.replies.map((r) => r.text)).toEqual(["latest reply"]);
  });

  it("binds thread replies to newer requestIds after thread reply", () => {
    const store = createThreadStore();
    const threadId = store.createThread(
      "coder",
      msg("u1", "You", "start"),
      "req-1",
    );

    store.replyInThread(threadId, msg("u2", "You", "follow-up"), "req-2");
    store.addReply("coder", msg("a2", "coder", "follow-up reply"), "req-2");

    const state = store.getSnapshot();
    const thread = state.threads.find((t) => t.id === threadId)!;
    expect(thread.replies.map((r) => r.text)).toEqual([
      "follow-up",
      "follow-up reply",
    ]);
  });
});
