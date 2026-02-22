export type SystemTarget = "tasks" | "cron";

export type ChannelId =
  | { kind: "conversation"; name: string }
  | { kind: "dm"; agentName: string }
  | { kind: "system"; name: SystemTarget };
