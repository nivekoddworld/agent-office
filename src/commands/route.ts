import type { Workspace } from "../workspace.js";

export function routeCommand(workspace: Workspace, chatId: string, agentName: string): void {
  if (!workspace.getAgent(agentName)) {
    console.log(`[route] Warning: agent "${agentName}" not found (will route when spawned)`);
  }
  workspace.setRoute(chatId, agentName);
  console.log(`[route] Chat ${chatId} → ${agentName}`);
}

export function routeListCommand(workspace: Workspace): void {
  const routes = workspace.getRoutes();
  if (routes.size === 0) {
    console.log("No routes configured.");
    return;
  }
  for (const [chatId, agent] of routes) {
    console.log(`  ${chatId} → ${agent}`);
  }
}
