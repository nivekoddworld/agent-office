export type HostFetch = (
  path: string,
  body: unknown,
  method?: string,
) => Promise<Response>;

export { createAuthenticatedFetchProxy } from "./authenticated-fetch.js";
export { createMessageAgentProxy } from "./message-agent.js";
export { createListAgentsProxy } from "./list-agents.js";
export { createReadAgentFileProxy } from "./read-agent-file.js";
export { createCronAddProxy } from "./cron-add.js";
export { createCronRemoveProxy } from "./cron-remove.js";
export { createCronListProxy } from "./cron-list.js";
export { createReadSkillProxy } from "./read-skill.js";
export { createSkillSearchProxy } from "./skill-search.js";
export { createSkillInstallProxy } from "./skill-install.js";
export { createSkillRemoveProxy } from "./skill-remove.js";
export { createSkillCreateProxy } from "./skill-create.js";
export { createTaskCreateProxy } from "./task-create.js";
export { createTaskUpdateProxy } from "./task-update.js";
export { createTaskListProxy } from "./task-list.js";
export { createTaskGetProxy } from "./task-get.js";
export { createTaskDeleteProxy } from "./task-delete.js";
export { createMessageUserProxy } from "./message-user.js";
export { createPostChannelProxy } from "./post-channel.js";
