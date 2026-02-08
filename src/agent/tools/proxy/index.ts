export type HostFetch = (path: string, body: unknown, method?: string) => Promise<Response>;

export { createSendMailProxy } from "./send-mail.js";
export { createListAgentsProxy } from "./list-agents.js";
export { createReadAgentFileProxy } from "./read-agent-file.js";
