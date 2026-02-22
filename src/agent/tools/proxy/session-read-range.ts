import type { AgentTool } from "@mariozechner/pi-agent-core";
import { SESSION_READ_RANGE } from "../contracts.js";
import type { HostFetch } from "./index.js";

const textResult = (text: string) => ({
  content: [{ type: "text" as const, text }],
  details: {},
});

export function createSessionReadRangeProxy(
  hostFetch: HostFetch,
): AgentTool<any> {
  return {
    ...SESSION_READ_RANGE,
    execute: async (
      _id,
      params: { sessionKey: string; fromSeq: number; toSeq: number },
    ) => {
      const res = await hostFetch("/api/session-read-range", params);
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as {
          error?: string;
        };
        return textResult(
          `Error: ${body.error ?? "session read range failed"}`,
        );
      }
      const body = (await res.json()) as { result: string };
      return textResult(body.result);
    },
  };
}
