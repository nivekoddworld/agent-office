export interface AgentHierarchy {
  manager: string | null; // null = reports to user
  peers: string[]; // agents sharing same manager (sorted)
  reports: string[]; // direct reports to this agent (sorted)
}

export function buildHierarchyMap(
  agents: Record<string, { reports_to?: string }>,
): Map<string, AgentHierarchy> {
  const names = Object.keys(agents);
  // Collect direct reports per manager (null key = user)
  const reportsByManager = new Map<string | null, string[]>();
  for (const name of names) {
    const mgr = agents[name]?.reports_to ?? null;
    const list = reportsByManager.get(mgr) ?? [];
    list.push(name);
    reportsByManager.set(mgr, list);
  }

  const result = new Map<string, AgentHierarchy>();
  for (const name of names) {
    const manager = agents[name]?.reports_to ?? null;
    const siblings = (reportsByManager.get(manager) ?? []).filter(
      (n) => n !== name,
    );
    const reports = (reportsByManager.get(name) ?? []).slice();
    result.set(name, {
      manager,
      peers: siblings.sort(),
      reports: reports.sort(),
    });
  }
  return result;
}

export function formatOrgChart(
  agents: Record<string, { reports_to?: string }>,
): string {
  const map = buildHierarchyMap(agents);
  const lines: string[] = ["user"];

  // Agents reporting to user (manager === null)
  const roots = [...map.entries()]
    .filter(([, h]) => h.manager === null)
    .map(([name]) => name)
    .sort();

  function renderChildren(children: string[], prefix: string): void {
    for (let i = 0; i < children.length; i++) {
      const name = children[i]!;
      const isLast = i === children.length - 1;
      const connector = isLast ? "└─" : "├─";
      lines.push(`${prefix}${connector} ${name}`);
      const h = map.get(name);
      if (h && h.reports.length > 0) {
        const childPrefix = prefix + (isLast ? "   " : "│  ");
        renderChildren(h.reports, childPrefix);
      }
    }
  }

  renderChildren(roots, "  ");
  return lines.join("\n");
}
