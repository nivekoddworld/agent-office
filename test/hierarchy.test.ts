import { describe, it, expect } from "vitest";
import { buildHierarchyMap, formatOrgChart } from "../src/config/hierarchy.js";

describe("buildHierarchyMap", () => {
  it("correct manager, peers, reports for multi-agent tree", () => {
    const map = buildHierarchyMap({
      lead: {},
      coder: { reports_to: "lead" },
      reviewer: { reports_to: "lead" },
      intern: { reports_to: "coder" },
    });

    const lead = map.get("lead")!;
    expect(lead.manager).toBeNull();
    expect(lead.peers).toEqual([]);
    expect(lead.reports).toEqual(["coder", "reviewer"]);

    const coder = map.get("coder")!;
    expect(coder.manager).toBe("lead");
    expect(coder.peers).toEqual(["reviewer"]);
    expect(coder.reports).toEqual(["intern"]);

    const reviewer = map.get("reviewer")!;
    expect(reviewer.manager).toBe("lead");
    expect(reviewer.peers).toEqual(["coder"]);
    expect(reviewer.reports).toEqual([]);

    const intern = map.get("intern")!;
    expect(intern.manager).toBe("coder");
    expect(intern.peers).toEqual([]);
    expect(intern.reports).toEqual([]);
  });

  it("agents with no reports_to report to null (user)", () => {
    const map = buildHierarchyMap({
      alpha: {},
      beta: {},
    });
    expect(map.get("alpha")!.manager).toBeNull();
    expect(map.get("beta")!.manager).toBeNull();
    expect(map.get("alpha")!.peers).toEqual(["beta"]);
    expect(map.get("beta")!.peers).toEqual(["alpha"]);
  });

  it("sorts peers and reports alphabetically", () => {
    const map = buildHierarchyMap({
      boss: {},
      zoe: { reports_to: "boss" },
      alice: { reports_to: "boss" },
      mike: { reports_to: "boss" },
    });
    expect(map.get("boss")!.reports).toEqual(["alice", "mike", "zoe"]);
    expect(map.get("alice")!.peers).toEqual(["mike", "zoe"]);
  });
});

describe("formatOrgChart", () => {
  it("renders tree with user at root", () => {
    const chart = formatOrgChart({
      lead: {},
      coder: { reports_to: "lead" },
      reviewer: { reports_to: "lead" },
    });
    expect(chart).toContain("user");
    expect(chart).toContain("lead");
    expect(chart).toContain("coder");
    expect(chart).toContain("reviewer");
  });

  it("renders correct tree structure", () => {
    const chart = formatOrgChart({
      lead: {},
      coder: { reports_to: "lead" },
      reviewer: { reports_to: "lead" },
    });
    const lines = chart.split("\n");
    expect(lines[0]).toBe("user");
    expect(lines[1]).toContain("└─ lead");
    // children of lead, sorted alphabetically
    expect(lines[2]).toContain("├─ coder");
    expect(lines[3]).toContain("└─ reviewer");
  });

  it("sorts children alphabetically at each level", () => {
    const chart = formatOrgChart({
      zach: {},
      alice: {},
      mike: {},
    });
    const lines = chart.split("\n");
    expect(lines[1]).toContain("alice");
    expect(lines[2]).toContain("mike");
    expect(lines[3]).toContain("zach");
  });

  it("handles multi-level nesting", () => {
    const chart = formatOrgChart({
      boss: {},
      dev: { reports_to: "boss" },
      intern: { reports_to: "dev" },
    });
    const lines = chart.split("\n");
    expect(lines[0]).toBe("user");
    expect(lines[1]).toContain("boss");
    expect(lines[2]).toContain("dev");
    expect(lines[3]).toContain("intern");
  });
});
