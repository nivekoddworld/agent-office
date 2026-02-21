import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockApiFetch } = vi.hoisted(() => ({
  mockApiFetch: vi.fn(),
}));

vi.mock("../ui/src/api/client.js", () => ({
  apiFetch: mockApiFetch,
}));

import { sendMessage } from "../ui/src/components/slack/send-message.js";

describe("sendMessage", () => {
  beforeEach(() => {
    mockApiFetch.mockReset();
  });

  it("sends message payload to /api/send", async () => {
    mockApiFetch.mockResolvedValueOnce({});

    await sendMessage({ agent: "pm", message: "hello" });

    expect(mockApiFetch).toHaveBeenCalledWith("/api/send", {
      method: "POST",
      body: JSON.stringify({ agent: "pm", message: "hello" }),
    });
  });

  it("includes requestId when provided", async () => {
    mockApiFetch.mockResolvedValueOnce({});

    await sendMessage({ agent: "pm", message: "hello", requestId: "req-1" });

    expect(mockApiFetch).toHaveBeenCalledWith("/api/send", {
      method: "POST",
      body: JSON.stringify({ agent: "pm", message: "hello", requestId: "req-1" }),
    });
  });

  it("throws when API call fails", async () => {
    mockApiFetch.mockRejectedValueOnce(new Error("boom"));

    await expect(sendMessage({ agent: "pm", message: "hello" })).rejects.toThrow(
      "boom",
    );
  });
});
