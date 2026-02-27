import type { Workspace } from "../workspace.js";

export interface HandlerContext {
  workspace: Workspace;
  officeId: string;
  getPort: () => number;
  broadcast: (type: string, data: unknown) => void;
  refreshChannels: () => void;
}
