import { apiFetch } from "../../api/client.js";

export interface SendMessageInput {
  agent: string;
  message: string;
  requestId?: string;
}

export function createClientRequestId(): string {
  if (
    typeof crypto !== "undefined" &&
    typeof crypto.randomUUID === "function"
  ) {
    return crypto.randomUUID();
  }
  return `req-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export async function sendMessage(input: SendMessageInput): Promise<void> {
  await apiFetch("/api/send", {
    method: "POST",
    body: JSON.stringify({
      agent: input.agent,
      message: input.message,
      ...(input.requestId ? { requestId: input.requestId } : {}),
    }),
  });
}

export interface ChannelSendInput {
  channel: string;
  message: string;
  mentions?: string[];
  requestId?: string;
}

export async function sendChannelMessage(
  input: ChannelSendInput,
): Promise<void> {
  await apiFetch(`/api/channels/${encodeURIComponent(input.channel)}/send`, {
    method: "POST",
    body: JSON.stringify({
      message: input.message,
      ...(input.mentions?.length ? { mentions: input.mentions } : {}),
      ...(input.requestId ? { requestId: input.requestId } : {}),
    }),
  });
}
