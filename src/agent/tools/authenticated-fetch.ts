import type { AgentTool } from "@mariozechner/pi-agent-core";
import { AUTHENTICATED_FETCH } from "./contracts.js";
import {
  validateFetchParams,
  FETCH_TIMEOUT_MS,
  MAX_RESPONSE_BODY,
  RESERVED_SECRET_NAMES,
  type FetchParams,
} from "./fetch-helpers.js";
import { redactText } from "../../security/redact.js";

const textResult = (text: string) => ({
  content: [{ type: "text" as const, text }],
  details: {},
});

export function createAuthenticatedFetchTool(
  resolvedSecrets: Record<string, string>,
): AgentTool<any> {
  return {
    ...AUTHENTICATED_FETCH,
    execute: async (_id, params: FetchParams) => {
      if (RESERVED_SECRET_NAMES.has(params.secretName)) {
        return textResult(
          `Error: Secret "${params.secretName}" cannot be used with authenticated_fetch.`,
        );
      }
      const secretValue = resolvedSecrets[params.secretName];
      if (!secretValue) {
        return textResult(
          `Error: Secret "${params.secretName}" not configured for this agent.`,
        );
      }

      const validation = await validateFetchParams(params, secretValue);
      if (!validation.ok) return textResult(`Error: ${validation.error}`);

      const { url, method, headers, body } = validation.result;
      try {
        const res = await fetch(url, {
          method,
          headers,
          body,
          signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
        });

        const responseBody = await res.text();
        if (Buffer.byteLength(responseBody, "utf-8") > MAX_RESPONSE_BODY) {
          return textResult(
            "Error: Response body too large (exceeds 5 MB limit).",
          );
        }

        const safeBody = redactText(responseBody, [secretValue]);
        return textResult(
          `HTTP ${res.status} ${res.statusText}\n\n${safeBody}`,
        );
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return textResult(`Error: Fetch failed — ${message}`);
      }
    },
  };
}
