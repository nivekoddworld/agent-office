import { describe, it, expect } from "vitest";
import { sessionKey } from "../src/messages/session-key.js";

describe("session-key", () => {
  it("builds dm keys", () => {
    expect(sessionKey("dm", "alice")).toBe("dm:alice");
  });
  it("builds channel keys", () => {
    expect(sessionKey("channel", "general")).toBe("ch:general");
  });
  it("builds internal keys", () => {
    expect(sessionKey("internal", "bob")).toBe("internal:bob");
  });
});
