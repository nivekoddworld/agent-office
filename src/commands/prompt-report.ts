import type { Workspace } from "../workspace.js";

export function promptReportCommand(
  workspace: Workspace,
  agentName: string,
): void {
  const handle = workspace.getAgent(agentName);
  if (!handle) {
    console.log(`Agent "${agentName}" not found.`);
    return;
  }

  const report = handle.getPromptReport();

  console.log(`\n=== Prompt Report: ${agentName} ===\n`);
  console.log(`Mode: ${report.mode}`);
  console.log(`Version: ${report.version}\n`);

  const total = report.blocks.reduce((sum, b) => sum + b.chars, 0);
  const labelWidth = 22;

  for (const block of report.blocks) {
    const label = blockLabel(block.name);
    const chars = block.chars.toLocaleString("en-US");
    console.log(`${label.padEnd(labelWidth)}${chars.padStart(8)} chars`);
  }

  console.log("─".repeat(labelWidth + 14));
  console.log(
    `${"Total".padEnd(labelWidth)}${total.toLocaleString("en-US").padStart(8)} chars`,
  );

  console.log(`\nTools: ${report.toolCount} registered`);
  if (report.skills.length > 0) {
    console.log(
      `Skills: ${report.skills.length} loaded (${report.skills.join(", ")})`,
    );
  } else {
    console.log("Skills: none");
  }
}

function blockLabel(name: string): string {
  const labels: Record<string, string> = {
    base: "Base prompt",
    office: "Office block",
    bootstrap: "Bootstrap files",
    memory: "Memory block",
    runtime: "Runtime block",
    identity: "Identity block",
    custom: "Custom prompt",
    skills: "Skills",
  };
  return labels[name] ?? name;
}
