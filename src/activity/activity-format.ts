/**
 * How agent activity is described, shared by the web UI's Activity tab and
 * the Discord activity channels. No imports: the UI bundles this file too.
 */

function str(v: unknown): string | undefined {
  return typeof v === "string" && v.trim() ? v : undefined;
}

/** First line, whitespace collapsed, shortened to `max` characters. */
export function preview(text: string, max = 80): string {
  const line = text.trim().split("\n")[0]!.replace(/\s+/g, " ");
  const more = line.length > max || text.trim().includes("\n");
  return line.length > max
    ? `${line.slice(0, max)}…`
    : more
      ? `${line} …`
      : line;
}

/** What a tool call was about, e.g. the command or file path. */
export function toolDetail(name: string, rawArgs: unknown): string {
  const a = (rawArgs && typeof rawArgs === "object" ? rawArgs : {}) as Record<
    string,
    unknown
  >;
  const quote = (v: unknown) => (str(v) ? `"${preview(str(v)!, 60)}"` : "");
  switch (name) {
    case "bash":
      return str(a.command) ? preview(str(a.command)!, 100) : "";
    case "read":
    case "write":
    case "edit":
    case "ls":
      return str(a.path) ?? "";
    case "find":
    case "grep":
      return [str(a.pattern), str(a.path) && `in ${a.path}`]
        .filter(Boolean)
        .join(" ");
    case "read_agent_file":
      return str(a.agent) ? `${a.agent}/${str(a.path) ?? ""}` : "";
    case "message_agent":
      return str(a.to) ? `to ${a.to}: ${quote(a.message)}` : "";
    case "message_user":
      return quote(a.message);
    case "post_channel":
      return str(a.channel)
        ? `#${String(a.channel).replace(/^#/, "")}: ${quote(a.message)}`
        : "";
    case "read_channel":
      return str(a.channel) ? `#${String(a.channel).replace(/^#/, "")}` : "";
    case "read_dm":
      return `with ${str(a.with) ?? "user"}`;
    case "task_get":
    case "task_delete":
      return str(a.id) ? `#${a.id}` : "";
    case "task_comment":
      return str(a.id) ? `#${a.id}: ${quote(a.message)}` : "";
    case "task_update":
      return str(a.id)
        ? `#${a.id}${a.restart ? " restart" : str(a.status) ? ` → ${a.status}` : ""}`
        : "";
    case "task_create":
      return [quote(a.title), str(a.assignee) && `for ${a.assignee}`]
        .filter(Boolean)
        .join(" ");
    case "task_list":
      return ["assignee", "status", "createdBy"]
        .filter((k) => str(a[k]))
        .map((k) => `${k}=${a[k]}`)
        .join(" ");
    case "authenticated_fetch":
      return str(a.url) ? `${str(a.method) ?? "GET"} ${a.url}` : "";
    default: {
      const first = Object.values(a).find((v) => str(v));
      return first ? preview(first as string, 80) : "";
    }
  }
}

export function formatDuration(ms: number): string {
  ms = Math.max(0, ms);
  if (ms < 1000) return `${(ms / 1000).toFixed(1)}s`;
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${s % 60}s`;
  return `${Math.floor(m / 60)}h ${m % 60}m`;
}

/** What woke an agent, e.g. "#work message from lead". */
export function triggerText(
  t: { from: string; text: string; channel?: string } | undefined,
  sessionKey?: string,
): string {
  if (t) {
    const first = preview(t.text, 70);
    if (t.from === "__user__")
      return t.channel ? `#${t.channel} message from user` : "DM from user";
    if (t.from === "__task__") return first;
    if (t.from === "__heartbeat__") return "heartbeat";
    if (t.from === "__cron__") return `scheduled: ${first}`;
    if (t.from.startsWith("__")) return first;
    return t.channel
      ? `#${t.channel} message from ${t.from}`
      : `message from ${t.from}`;
  }
  const sk = sessionKey ?? "";
  if (sk.startsWith("dm:")) return "DM";
  if (sk.startsWith("ch:")) return `#${sk.slice(3)}`;
  if (sk.startsWith("heartbeat:")) return "heartbeat";
  if (sk.startsWith("internal:")) return "internal";
  return "activity";
}
