export type SystemTarget =
  | "tasks"
  | "cron"
  | "debug"
  | "cost"
  | "collaboration"
  | "settings";

export type ChannelId =
  | { kind: "conversation"; name: string }
  | { kind: "dm"; agentName: string }
  | { kind: "system"; name: SystemTarget };
