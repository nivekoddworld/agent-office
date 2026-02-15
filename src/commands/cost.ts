import {
  readUsageRecords,
  summarizeUsage,
  type UsageSummary,
} from "../metrics/usage-tracker.js";

/** In-memory accumulator — resets on process restart. */
const sessionAccum = {
  totalTokens: 0,
  totalCost: 0,
  byAgent: new Map<string, { totalTokens: number; totalCost: number }>(),
};

export function accumulateSession(
  agent: string,
  totalTokens: number,
  totalCost: number,
): void {
  sessionAccum.totalTokens += totalTokens;
  sessionAccum.totalCost += totalCost;
  const a = sessionAccum.byAgent.get(agent) ?? {
    totalTokens: 0,
    totalCost: 0,
  };
  a.totalTokens += totalTokens;
  a.totalCost += totalCost;
  sessionAccum.byAgent.set(agent, a);
}

export function costStatusCommand(): void {
  console.log("\n=== Cost Status (session) ===\n");
  console.log(
    `Total tokens: ${sessionAccum.totalTokens.toLocaleString("en-US")}`,
  );
  console.log(`Total cost:   $${sessionAccum.totalCost.toFixed(4)}`);

  if (sessionAccum.byAgent.size > 0) {
    console.log("\nPer agent:");
    for (const [name, data] of sessionAccum.byAgent) {
      console.log(
        `  ${name.padEnd(20)} ${data.totalTokens.toLocaleString("en-US").padStart(10)} tokens  $${data.totalCost.toFixed(4)}`,
      );
    }
  }
  console.log(
    "\nNote: Totals since gateway start; resets on restart. Use `cost today` for persistent totals.",
  );
}

export function costTodayCommand(
  officeDir: string,
  agent?: string,
): void {
  const now = new Date();
  const startOfDay = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate(),
  );
  const records = readUsageRecords(officeDir).filter(
    (r) => new Date(r.ts) >= startOfDay,
  );
  const filtered = agent ? records.filter((r) => r.agent === agent) : records;
  const summary = summarizeUsage(filtered);

  const label = agent ? ` (agent: ${agent})` : "";
  console.log(`\n=== Cost Today${label} ===\n`);
  printSummary(summary);
}

export function costReportCommand(
  officeDir: string,
  days: number,
  agent?: string,
): void {
  const records = readUsageRecords(officeDir, { days, agent });
  const summary = summarizeUsage(records);

  const label = agent ? ` (agent: ${agent})` : "";
  console.log(`\n=== Cost Report — last ${days} day(s)${label} ===\n`);
  printSummary(summary);
}

function printSummary(summary: UsageSummary): void {
  console.log(
    `Total tokens: ${summary.totalTokens.toLocaleString("en-US")}`,
  );
  console.log(`  Input:       ${summary.inputTokens.toLocaleString("en-US")}`);
  console.log(
    `  Output:      ${summary.outputTokens.toLocaleString("en-US")}`,
  );
  console.log(
    `  Cache read:  ${summary.cacheReadTokens.toLocaleString("en-US")}`,
  );
  console.log(
    `  Cache write: ${summary.cacheWriteTokens.toLocaleString("en-US")}`,
  );
  console.log(`\nTotal cost:   $${summary.totalCost.toFixed(4)}`);

  if (summary.byAgent.size > 0) {
    console.log("\nPer agent:");
    for (const [name, data] of summary.byAgent) {
      console.log(
        `  ${name.padEnd(20)} ${data.totalTokens.toLocaleString("en-US").padStart(10)} tokens  $${data.totalCost.toFixed(4)}`,
      );
    }
  }
}
