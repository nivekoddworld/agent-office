export type HostFetch = (
  path: string,
  body: unknown,
  method?: string,
) => Promise<Response>;

export { createAuthenticatedFetchProxy } from "./authenticated-fetch.js";
export { createSendMailProxy } from "./send-mail.js";
export { createListAgentsProxy } from "./list-agents.js";
export { createReadAgentFileProxy } from "./read-agent-file.js";
export { createMemorySearchProxy } from "./memory-search.js";
export { createMemoryGetProxy } from "./memory-get.js";
