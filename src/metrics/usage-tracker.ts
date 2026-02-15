import { appendFileSync, readFileSync, mkdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";

export interface UsageRecord {
  ts: string;
  officeId: string;
  agent: string;
  provider: string;
  model: string;
  stopReason?: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  totalTokens: number;
  inputCost: number;
  outputCost: number;
  cacheReadCost: number;
  cacheWriteCost: number;
  totalCost: number;
}

export interface UsageSummary {
  totalTokens: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  totalCost: number;
  inputCost: number;
  outputCost: number;
  cacheReadCost: number;
  cacheWriteCost: number;
  byAgent: Map<string, { totalTokens: number; totalCost: number }>;
}

function usagePath(officeDir: string): string {
  return join(officeDir, "logs", "usage-cost.jsonl");
}

export function recordUsage(officeDir: string, record: UsageRecord): void {
  const path = usagePath(officeDir);
  const dir = dirname(path);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  appendFileSync(path, JSON.stringify(record) + "\n");
}

export function readUsageRecords(
  officeDir: string,
  opts?: { days?: number; agent?: string },
): UsageRecord[] {
  const path = usagePath(officeDir);
  if (!existsSync(path)) return [];

  const content = readFileSync(path, "utf-8");
  const lines = content.split("\n").filter((l) => l.trim());
  let records = lines.map((l) => JSON.parse(l) as UsageRecord);

  if (opts?.days && Number.isFinite(opts.days) && opts.days > 0) {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - (opts.days - 1));
    cutoff.setHours(0, 0, 0, 0);
    const cutoffIso = cutoff.toISOString();
    records = records.filter((r) => r.ts >= cutoffIso);
  }

  if (opts?.agent) {
    records = records.filter((r) => r.agent === opts.agent);
  }

  return records;
}

export function summarizeUsage(records: UsageRecord[]): UsageSummary {
  const summary: UsageSummary = {
    totalTokens: 0,
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    totalCost: 0,
    inputCost: 0,
    outputCost: 0,
    cacheReadCost: 0,
    cacheWriteCost: 0,
    byAgent: new Map(),
  };

  for (const r of records) {
    summary.totalTokens += r.totalTokens;
    summary.inputTokens += r.inputTokens;
    summary.outputTokens += r.outputTokens;
    summary.cacheReadTokens += r.cacheReadTokens;
    summary.cacheWriteTokens += r.cacheWriteTokens;
    summary.totalCost += r.totalCost;
    summary.inputCost += r.inputCost;
    summary.outputCost += r.outputCost;
    summary.cacheReadCost += r.cacheReadCost;
    summary.cacheWriteCost += r.cacheWriteCost;

    const agent = summary.byAgent.get(r.agent) ?? {
      totalTokens: 0,
      totalCost: 0,
    };
    agent.totalTokens += r.totalTokens;
    agent.totalCost += r.totalCost;
    summary.byAgent.set(r.agent, agent);
  }

  return summary;
}
