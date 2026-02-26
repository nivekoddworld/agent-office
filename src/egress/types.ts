import type { MessageBus } from "../transport/message-bus.js";
import type { MessageStore } from "../messages/message-store.js";
import type { ChannelConfig } from "../types.js";

export interface EgressContext {
  agentName: string;
  idempotencyKey?: string;
  requestId?: string;
  correlationId?: string;
  originSession?: string;
  hopCount: number;
}

export interface EgressDeps {
  messageStore?: MessageStore;
  baseDir: string;
  bus: MessageBus;
  channels: Map<string, ChannelConfig>;
  onStateChanged?: () => void;
  now?: () => number;
}

export type EgressResult =
  | { ok: true; egressId: string; targets?: string[] }
  | { ok: false; reason: string };

export const MAX_HOPS = 5;
export const CHANNEL_RATE_LIMIT = 5;
export const CHANNEL_RATE_WINDOW_MS = 30_000;
export const MAX_MESSAGE_LENGTH = 65_536;
export const RECENT_IDS_CAPACITY = 256;
export const EGRESS_NAMESPACE = "f47ac10b-58cc-4372-a567-0e02b2c3d479";
