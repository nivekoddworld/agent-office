import { CronExpressionParser } from "cron-parser";

// 5-field cron only — we prepend "0" for the seconds field that cron-parser expects.
const SHORTHAND_RE = /^@/;

/** Parse a 5-field cron expression into a CronExpression. */
function parse(schedule: string, timezone?: string, currentDate?: Date) {
  // Prepend seconds field (0) so cron-parser gets the 6-field format it expects
  const sixField = `0 ${schedule}`;
  return CronExpressionParser.parse(sixField, {
    tz: timezone ?? "UTC",
    ...(currentDate ? { currentDate } : {}),
  });
}

/** Next fire time from a 5-field cron schedule. */
export function nextFireTime(schedule: string, timezone?: string, after?: Date): Date {
  const expr = parse(schedule, timezone, after);
  return expr.next().toDate();
}

/** Previous fire time from a 5-field cron schedule. */
export function prevFireTime(schedule: string, timezone?: string, before?: Date): Date {
  const expr = parse(schedule, timezone, before);
  return expr.prev().toDate();
}

/** Validate a cron expression: must be 5-field, no @ shorthands. */
export function isValidCron(schedule: string): boolean {
  if (SHORTHAND_RE.test(schedule)) return false;
  const fields = schedule.trim().split(/\s+/);
  if (fields.length !== 5) return false;
  try {
    parse(schedule);
    return true;
  } catch {
    return false;
  }
}

/** Human-readable description for common cron patterns. Fallback: raw schedule. */
export function describeCron(schedule: string): string {
  const parts = schedule.trim().split(/\s+/);
  if (parts.length !== 5) return schedule;
  const [min, hour, dom, month, dow] = parts as [string, string, string, string, string];

  const allStar = (f: string) => f === "*";
  const pad = (n: string) => n.padStart(2, "0");

  // "* * * * *" → every minute
  if (allStar(min) && allStar(hour) && allStar(dom) && allStar(month) && allStar(dow)) {
    return "every minute";
  }

  // "N * * * *" → every hour at :N
  if (!allStar(min) && allStar(hour) && allStar(dom) && allStar(month) && allStar(dow)) {
    if (min === "0") return "every hour";
    return `every hour at :${pad(min)}`;
  }

  const dayLabel = describeDow(dow);

  // "N H * * *" → every day at HH:MM
  if (!allStar(min) && !allStar(hour) && allStar(dom) && allStar(month) && allStar(dow)) {
    return `every day at ${pad(hour)}:${pad(min)}`;
  }

  // "N H * * DOW" → <days> at HH:MM
  if (!allStar(min) && !allStar(hour) && allStar(dom) && allStar(month) && !allStar(dow)) {
    return `${dayLabel} at ${pad(hour)}:${pad(min)}`;
  }

  return schedule;
}

const DOW_NAMES: Record<string, string> = {
  "0": "Sun", "1": "Mon", "2": "Tue", "3": "Wed", "4": "Thu", "5": "Fri", "6": "Sat", "7": "Sun",
};

function describeDow(dow: string): string {
  if (dow === "1-5") return "Mon–Fri";
  if (dow === "0,6") return "Sat, Sun";
  if (dow === "6,0") return "Sat, Sun";
  const name = DOW_NAMES[dow];
  if (name) return name;
  return dow;
}
