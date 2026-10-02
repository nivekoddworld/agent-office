import type { ActivityEntry } from "../../activity/activity-log.js";
import type { Task } from "../../tasks/types.js";
import type { Attachment, ChannelConfig } from "../../types.js";
import type { DiscordImage } from "./types.js";

export interface BridgeHost {
  officeName(): string;
  channels(): Map<string, ChannelConfig>;
  agentNames(): string[];
  sendUserDm(
    agent: string,
    text: string,
    origin: string,
    attachments?: Attachment[],
  ): { ok: boolean; error?: string };
  postUserChannel(
    channel: string,
    text: string,
    mentions: string[],
    origin: string,
    attachments?: Attachment[],
  ): { ok: boolean; error?: string };
  /** File path of an uploaded image attachment. */
  attachmentPath(id: string): string;
  /** Save an image posted in Discord as an upload, so agents can see it. */
  importImage?(img: DiscordImage): Promise<Attachment>;
  /** The office's tasks, for the tasks forum, #status and alerts. */
  tasks?(): Task[];
  /** For /stop, /wake and /clear: each returns what to tell you. */
  stopAgent?(name: string): string;
  wakeAgent?(name: string): string;
  clearAgent?(name: string): string;
  /** An agent's activity log since a time, for the daily summary. */
  activitySince?(agent: string, since: number): ActivityEntry[];
  /** A task you started as a forum post; an error message if it failed. */
  createTask?(t: {
    title: string;
    description: string;
    assignee: string;
  }): Task | string;
}

export interface BridgeOptions {
  guildId: string;
  /** Where channel, role and webhook ids are remembered between restarts. */
  statePath: string;
  /** Avatar image for a sender name, if any. */
  avatarUrl?: (name: string) => string | undefined;
  /** Activity channels, #status and the bot's status line (default on). */
  activity?: boolean;
  /** Largest file to upload (default 10 MB, Discord's limit without boosts). */
  maxUploadBytes?: number;
  /** Relay throttling, for tests. */
  activityIntervals?: { editIntervalMs?: number; presenceIntervalMs?: number };
  /** Typing indicator while an agent works on a reply (default on). */
  typing?: boolean;
  /** How often typing is refreshed, for tests. */
  typingRefreshMs?: number;
  /** #alerts: failed or stuck tasks, failing agents (default on, pinging
   *  office-user; "quiet" posts without the ping). */
  alerts?: boolean | "quiet";
  /** When to post the daily summary ("HH:MM", local time), or "off". */
  summaryAt?: string;
}
