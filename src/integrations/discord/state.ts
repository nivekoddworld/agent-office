import { readFileSync } from "node:fs";
import type { WebhookRef } from "./types.js";

/** What the Discord bridge remembers between restarts (discord.json). */
export interface BridgeState {
  guildId: string;
  categories: Record<string, string>;
  /** "ch:general", "dm:coder", "pair:coder|lead" → Discord channel id. */
  channels: Record<string, string>;
  /** Agent name → role id. */
  roles: Record<string, string>;
  /** Discord channel id → webhook. */
  webhooks: Record<string, WebhookRef>;
  /** The office-user role (humans who get pinged). */
  userRole?: string;
  /** The live message in #status. */
  statusMessageId?: string;
}

export function emptyState(guildId: string): BridgeState {
  return { guildId, categories: {}, channels: {}, roles: {}, webhooks: {} };
}

export function loadState(path: string, guildId: string): BridgeState {
  try {
    const s = JSON.parse(readFileSync(path, "utf-8")) as BridgeState;
    if (s.guildId === guildId) return { ...emptyState(guildId), ...s };
  } catch {
    // first run, or unreadable: start fresh
  }
  return emptyState(guildId);
}
