const DAY_NAMES: Record<string, string> = {
  "0": "Sun",
  "1": "Mon",
  "2": "Tue",
  "3": "Wed",
  "4": "Thu",
  "5": "Fri",
  "6": "Sat",
  "7": "Sun",
};

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

function parseDays(field: string): string {
  if (field === "1-5") return "Weekdays";
  if (field === "0,6" || field === "6,0") return "Weekends";
  if (field === "*") return "";

  const parts = field.split(",");
  const names = parts.map((p) => {
    const range = p.split("-");
    if (range.length === 2) {
      return `${DAY_NAMES[range[0]!] ?? range[0]}–${DAY_NAMES[range[1]!] ?? range[1]}`;
    }
    return DAY_NAMES[p] ?? p;
  });
  return names.join(", ");
}

export function humanReadableCron(expression: string): string {
  const parts = expression.trim().split(/\s+/);
  if (parts.length !== 5) return expression;

  const minute = parts[0]!;
  const hour = parts[1]!;
  const dayOfMonth = parts[2]!;
  const month = parts[3]!;
  const dayOfWeek = parts[4]!;

  // Every N minutes: */15 * * * *
  if (
    minute.startsWith("*/") &&
    hour === "*" &&
    dayOfMonth === "*" &&
    month === "*" &&
    dayOfWeek === "*"
  ) {
    const interval = minute.slice(2);
    return `Every ${interval} minutes`;
  }

  // Every minute: * * * * *
  if (
    minute === "*" &&
    hour === "*" &&
    dayOfMonth === "*" &&
    month === "*" &&
    dayOfWeek === "*"
  ) {
    return "Every minute";
  }

  // Hourly: N * * * *
  if (
    hour === "*" &&
    dayOfMonth === "*" &&
    month === "*" &&
    dayOfWeek === "*"
  ) {
    const m = parseInt(minute, 10);
    if (minute === "0") return "Every hour";
    return `Every hour at :${pad(m)}`;
  }

  // Daily / Weekly with specific hour+minute
  const h = parseInt(hour, 10);
  const m = parseInt(minute, 10);

  if (isNaN(h) || isNaN(m)) return expression;

  const timeStr = `${pad(h)}:${pad(m)}`;

  // Daily: M H * * *
  if (dayOfMonth === "*" && month === "*" && dayOfWeek === "*") {
    return `Every day at ${timeStr}`;
  }

  // Weekly / specific days: M H * * DOW
  if (dayOfMonth === "*" && month === "*" && dayOfWeek !== "*") {
    const days = parseDays(dayOfWeek);
    if (days === "Weekdays") return `Weekdays at ${timeStr}`;
    if (days === "Weekends") return `Weekends at ${timeStr}`;
    return `${days} at ${timeStr}`;
  }

  // Monthly: M H DOM * *
  if (dayOfMonth !== "*" && month === "*" && dayOfWeek === "*") {
    return `Monthly on day ${dayOfMonth} at ${timeStr}`;
  }

  return expression;
}

/**
 * Reverse-parse a cron expression back into structured fields for the form.
 * Returns null if the expression can't be cleanly mapped to a preset frequency.
 */
export function parseCronToFields(expression: string): {
  frequency: "hourly" | "daily" | "weekly" | "custom";
  minute: number;
  hour: number;
  days: string[];
} | null {
  const parts = expression.trim().split(/\s+/);
  if (parts.length !== 5) return null;

  const minStr = parts[0]!;
  const hourStr = parts[1]!;
  const dom = parts[2]!;
  const mon = parts[3]!;
  const dow = parts[4]!;

  const minute = parseInt(minStr, 10);
  const hour = parseInt(hourStr, 10);

  // Hourly: N * * * *
  if (
    hourStr === "*" &&
    dom === "*" &&
    mon === "*" &&
    dow === "*" &&
    !isNaN(minute)
  ) {
    return { frequency: "hourly", minute, hour: 9, days: [] };
  }

  // Daily: N H * * *
  if (
    dom === "*" &&
    mon === "*" &&
    dow === "*" &&
    !isNaN(minute) &&
    !isNaN(hour)
  ) {
    return { frequency: "daily", minute, hour, days: [] };
  }

  // Weekly: N H * * DOW
  if (
    dom === "*" &&
    mon === "*" &&
    dow !== "*" &&
    !isNaN(minute) &&
    !isNaN(hour)
  ) {
    const days: string[] = [];
    for (const part of dow.split(",")) {
      const range = part.split("-");
      if (range.length === 2) {
        const start = parseInt(range[0]!, 10);
        const end = parseInt(range[1]!, 10);
        for (let i = start; i <= end; i++) {
          days.push(String(i));
        }
      } else {
        days.push(part);
      }
    }
    return { frequency: "weekly", minute, hour, days };
  }

  return null;
}
