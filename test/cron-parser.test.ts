import { describe, it, expect } from "vitest";
import { nextFireTime, prevFireTime, isValidCron, describeCron } from "../src/cron/cron-parser.js";

describe("isValidCron", () => {
  it("accepts valid 5-field expressions", () => {
    expect(isValidCron("0 9 * * 1-5")).toBe(true);
    expect(isValidCron("*/5 * * * *")).toBe(true);
    expect(isValidCron("0 0 1 1 *")).toBe(true);
  });

  it("rejects @ shorthands", () => {
    expect(isValidCron("@daily")).toBe(false);
    expect(isValidCron("@hourly")).toBe(false);
    expect(isValidCron("@yearly")).toBe(false);
  });

  it("rejects non-5-field expressions", () => {
    expect(isValidCron("* * * *")).toBe(false);       // 4 fields
    expect(isValidCron("0 0 0 * * *")).toBe(false);   // 6 fields
    expect(isValidCron("")).toBe(false);
  });

  it("rejects invalid cron syntax", () => {
    expect(isValidCron("99 99 99 99 99")).toBe(false);
    expect(isValidCron("abc def ghi jkl mno")).toBe(false);
  });
});

describe("nextFireTime", () => {
  it("returns correct next fire time", () => {
    // Every hour at :00 — after 2024-01-15 14:30 UTC → 2024-01-15 15:00 UTC
    const after = new Date("2024-01-15T14:30:00.000Z");
    const next = nextFireTime("0 * * * *", "UTC", after);
    expect(next.toISOString()).toBe("2024-01-15T15:00:00.000Z");
  });

  it("handles daily schedule", () => {
    const after = new Date("2024-01-15T10:00:00.000Z");
    const next = nextFireTime("0 9 * * *", "UTC", after);
    // 9:00 already passed today → next day 9:00
    expect(next.toISOString()).toBe("2024-01-16T09:00:00.000Z");
  });

  it("respects timezone", () => {
    // 9am New York = 14:00 UTC (EST, Jan = no DST)
    const after = new Date("2024-01-15T13:00:00.000Z"); // 8am NY
    const next = nextFireTime("0 9 * * *", "America/New_York", after);
    expect(next.toISOString()).toBe("2024-01-15T14:00:00.000Z");
  });
});

describe("prevFireTime", () => {
  it("returns correct previous fire time", () => {
    const before = new Date("2024-01-15T14:30:00.000Z");
    const prev = prevFireTime("0 * * * *", "UTC", before);
    expect(prev.toISOString()).toBe("2024-01-15T14:00:00.000Z");
  });

  it("handles daily schedule", () => {
    const before = new Date("2024-01-15T10:00:00.000Z");
    const prev = prevFireTime("0 9 * * *", "UTC", before);
    expect(prev.toISOString()).toBe("2024-01-15T09:00:00.000Z");
  });
});

describe("describeCron", () => {
  it("describes every minute", () => {
    expect(describeCron("* * * * *")).toBe("every minute");
  });

  it("describes every hour", () => {
    expect(describeCron("0 * * * *")).toBe("every hour");
  });

  it("describes every hour at :MM", () => {
    expect(describeCron("30 * * * *")).toBe("every hour at :30");
  });

  it("describes daily at HH:MM", () => {
    expect(describeCron("0 9 * * *")).toBe("every day at 09:00");
  });

  it("describes weekday schedule", () => {
    expect(describeCron("0 9 * * 1-5")).toBe("Mon–Fri at 09:00");
  });

  it("falls back to raw for complex expressions", () => {
    expect(describeCron("*/5 1-3 1,15 * *")).toBe("*/5 1-3 1,15 * *");
  });
});
