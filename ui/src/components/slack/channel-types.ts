export type SystemTarget =
  | "tasks"
  | "cron"
  | "debug"
  | "cost"
  | "collaboration"
  | "settings"
  | "org-chart";

export type ChannelId =
  | { kind: "conversation"; name: string }
  | { kind: "dm"; agentName: string }
  | { kind: "system"; name: SystemTarget };
