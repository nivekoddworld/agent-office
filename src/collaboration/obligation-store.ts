import { randomUUID } from "node:crypto";
import {
  readFileSync,
  writeFileSync,
  renameSync,
  existsSync,
  mkdirSync,
} from "node:fs";
import { join } from "node:path";

export interface Obligation {
  id: string;
  correlationId: string;
  from: string;
  to: string;
  replyByTs: number;
  createdAt: number;
  originTaskId?: string;
  fulfilled: boolean;
  fulfilledAt?: number;
}

export class ObligationStore {
  private obligations = new Map<string, Obligation>(); // keyed by correlationId
  private storePath: string;

  constructor(private dir: string) {
    mkdirSync(dir, { recursive: true });
    this.storePath = join(dir, "obligations.json");
    this._load();
  }

  add(params: {
    correlationId: string;
    from: string;
    to: string;
    replyByTs: number;
    originTaskId?: string;
  }): Obligation {
    const obligation: Obligation = {
      id: randomUUID(),
      ...params,
      createdAt: Date.now(),
      fulfilled: false,
    };
    this.obligations.set(params.correlationId, obligation);
    this._save();
    return obligation;
  }

  fulfill(correlationId: string): boolean {
    const o = this.obligations.get(correlationId);
    if (!o || o.fulfilled) return false;
    o.fulfilled = true;
    o.fulfilledAt = Date.now();
    this._save();
    return true;
  }

  getOverdue(nowMs = Date.now()): Obligation[] {
    return [...this.obligations.values()].filter(
      (o) => !o.fulfilled && o.replyByTs < nowMs,
    );
  }

  getPending(): Obligation[] {
    return [...this.obligations.values()].filter((o) => !o.fulfilled);
  }

  cleanup(retentionMs = 24 * 60 * 60 * 1000): void {
    const cutoff = Date.now() - retentionMs;
    for (const [key, o] of this.obligations) {
      if (o.fulfilled && (o.fulfilledAt ?? 0) < cutoff) {
        this.obligations.delete(key);
      }
    }
    this._save();
  }

  private _load(): void {
    if (!existsSync(this.storePath)) return;
    try {
      const data = JSON.parse(
        readFileSync(this.storePath, "utf8"),
      ) as Obligation[];
      for (const o of data) {
        this.obligations.set(o.correlationId, o);
      }
    } catch {
      // corrupt file — start fresh
    }
  }

  private _save(): void {
    const tmp = this.storePath + ".tmp";
    writeFileSync(
      tmp,
      JSON.stringify([...this.obligations.values()], null, 2),
      "utf8",
    );
    renameSync(tmp, this.storePath);
  }
}

export function createObligationStore(dir: string): ObligationStore {
  return new ObligationStore(dir);
}
