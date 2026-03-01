import { randomUUID, createHash } from "node:crypto";
import { appendFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { Priority } from "../types.js";
import { sessionKey } from "../messages/session-key.js";
import {
  CHANNEL_RATE_LIMIT,
  CHANNEL_RATE_WINDOW_MS,
  EGRESS_NAMESPACE,
  MAX_HOPS,
  MAX_MESSAGE_LENGTH,
  RECENT_IDS_CAPACITY,
  type EgressContext,
  type EgressDeps,
  type EgressResult,
} from "./types.js";

const CHANNEL_NAME_RE = /^[a-zA-Z0-9_-]+$/;

/** Derive a deterministic egress ID from an idempotency key. */
function deriveEgressId(key: string): string {
  const hash = createHash("sha256")
    .update(EGRESS_NAMESPACE)
    .update(key)
    .digest("hex");
  // Format as UUID-like: 8-4-4-4-12
  return [
    hash.slice(0, 8),
    hash.slice(8, 12),
    hash.slice(12, 16),
    hash.slice(16, 20),
    hash.slice(20, 32),
  ].join("-");
}

/** Simple LRU-like recent IDs set for JSONL write dedup. */
class RecentIds {
  private _ids: string[] = [];
  private _set = new Set<string>();
  private readonly _capacity: number;

  constructor(capacity: number) {
    this._capacity = capacity;
  }

  has(id: string): boolean {
    return this._set.has(id);
  }

  add(id: string): void {
    if (this._set.has(id)) return;
    this._set.add(id);
    this._ids.push(id);
    if (this._ids.length > this._capacity) {
      const evicted = this._ids.shift()!;
      this._set.delete(evicted);
    }
  }
}

/** Per-agent per-channel rate limiter state. */
const rateLimitWindows = new Map<string, number[]>();

function checkRateLimit(
  agentName: string,
  channel: string,
  now: number,
): boolean {
  const key = `${agentName}:${channel}`;
  let timestamps = rateLimitWindows.get(key);
  if (!timestamps) {
    timestamps = [];
    rateLimitWindows.set(key, timestamps);
  }
  // Evict old entries
  const cutoff = now - CHANNEL_RATE_WINDOW_MS;
  while (timestamps.length > 0 && timestamps[0]! < cutoff) {
    timestamps.shift();
  }
  if (timestamps.length >= CHANNEL_RATE_LIMIT) return false;
  timestamps.push(now);
  return true;
}

const recentIds = new RecentIds(RECENT_IDS_CAPACITY);

export function messageUser(
  ctx: EgressContext,
  deps: EgressDeps,
  message: string,
): EgressResult {
  const egressId = ctx.idempotencyKey
    ? deriveEgressId(ctx.idempotencyKey)
    : randomUUID();

  const trimmed = message.trim();
  if (!trimmed) return { ok: false, reason: "validation" };
  if (trimmed.length > MAX_MESSAGE_LENGTH)
    return { ok: false, reason: "validation" };

  try {
    // Persist to SQLite (returns false if duplicate egressId)
    let sqliteDup = false;
    if (deps.messageStore) {
      const inserted = deps.messageStore.saveDm({
        agent: ctx.agentName,
        role: "assistant",
        text: trimmed,
        ts_ms: (deps.now ?? Date.now)(),
        request_id: ctx.requestId ?? null,
        egress_id: egressId,
        correlation_id: ctx.correlationId ?? null,
      });
      sqliteDup = !inserted;
    }

    // Persist to JSONL (skip if SQLite confirmed duplicate OR recentIds hit)
    if (!sqliteDup && !recentIds.has(egressId)) {
      const dir = join(deps.baseDir, "agents", ctx.agentName, "sessions");
      mkdirSync(dir, { recursive: true });
      const entry = {
        ts: new Date().toISOString(),
        role: "assistant",
        from: ctx.agentName,
        text: trimmed,
        egressId,
        requestId: ctx.requestId,
        correlationId: ctx.correlationId,
        originSession: ctx.originSession,
        hopCount: ctx.hopCount,
      };
      appendFileSync(
        join(dir, "user-dm.jsonl"),
        JSON.stringify(entry) + "\n",
        "utf-8",
      );
      recentIds.add(egressId);
    }

    deps.onStateChanged?.();
    return { ok: true, egressId };
  } catch (err) {
    console.error("[egress] messageUser failed:", err);
    return { ok: false, reason: "internal_error" };
  }
}

export function postChannel(
  ctx: EgressContext,
  deps: EgressDeps,
  channel: string,
  message: string,
  mentions?: string[],
  priority?: Priority,
): EgressResult {
  const egressId = ctx.idempotencyKey
    ? deriveEgressId(ctx.idempotencyKey)
    : randomUUID();

  const trimmed = message.trim();
  if (!trimmed || !CHANNEL_NAME_RE.test(channel))
    return { ok: false, reason: "validation" };
  if (trimmed.length > MAX_MESSAGE_LENGTH)
    return { ok: false, reason: "validation" };

  const channelConfig = deps.channels.get(channel);
  if (!channelConfig) return { ok: false, reason: "validation" };

  const isUser = ctx.agentName === "__user__";

  // Membership check (skip for __user__)
  if (!isUser && !channelConfig.members.includes(ctx.agentName)) {
    return { ok: false, reason: "not_member" };
  }

  // Validate mentions are members
  if (mentions?.length) {
    for (const m of mentions) {
      if (!channelConfig.members.includes(m)) {
        return { ok: false, reason: "validation" };
      }
    }
  }

  // Hop count check (skip for __user__)
  if (!isUser && ctx.hopCount >= MAX_HOPS) {
    return { ok: false, reason: "hop_limit" };
  }

  // Rate limit (skip for __user__)
  const now = (deps.now ?? Date.now)();
  if (!isUser && !checkRateLimit(ctx.agentName, channel, now)) {
    return { ok: false, reason: "rate_limited" };
  }

  try {
    const envelope = {
      ts: new Date().toISOString(),
      role: ctx.agentName === "__user__" ? "user" : "assistant",
      from: ctx.agentName,
      text: trimmed,
      channel,
      egressId,
      requestId: ctx.requestId,
      correlationId: ctx.correlationId,
      originSession: ctx.originSession,
      hopCount: ctx.hopCount,
      mentions,
    };

    // Write JSONL to all channel members
    if (!recentIds.has(egressId)) {
      for (const member of channelConfig.members) {
        const dir = join(deps.baseDir, "agents", member, "sessions");
        mkdirSync(dir, { recursive: true });
        appendFileSync(
          join(dir, `channel-${channel}.jsonl`),
          JSON.stringify(envelope) + "\n",
          "utf-8",
        );
      }
      recentIds.add(egressId);
    }

    // User/system sources broadcast to all; agents require explicit mentions
    const isSystemSource =
      ctx.agentName === "__user__" || ctx.agentName.startsWith("__");
    const targets = mentions?.length
      ? mentions
      : isSystemSource
        ? channelConfig.members
        : []; // agent without mentions = announcement only (JSONL persisted above)
    const busTargets = targets.filter((m) => m !== ctx.agentName);
    const sk = sessionKey("channel", channel);
    for (const target of busTargets) {
      deps.bus.send({
        from: ctx.agentName,
        to: target,
        type: "prompt",
        payload: trimmed,
        priority: priority ?? Priority.NORMAL,
        sessionKey: sk,
        sourceKind: "channel",
        channel,
        hopCount: ctx.hopCount + 1,
      });
    }

    deps.onStateChanged?.();
    return { ok: true, egressId, targets: busTargets };
  } catch (err) {
    console.error("[egress] postChannel failed:", err);
    return { ok: false, reason: "internal_error" };
  }
}

/** Reset rate limit state (for testing). */
export function _resetRateLimits(): void {
  rateLimitWindows.clear();
}
