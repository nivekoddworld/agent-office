import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";

export interface SessionEntry {
  ts: string;
  role: "user" | "assistant";
  from: string;
  text: string;
  kind?: string;
  jobName?: string;
}

const MAX_LINES = 500;
const KEEP_LINES = 400;

/** Map a session key (e.g. "dm:alice") to its JSONL filename. */
export function sessionFilename(sessionKey: string): string {
  const idx = sessionKey.indexOf(":");
  if (idx < 0) return "unknown.jsonl";
  const prefix = sessionKey.slice(0, idx);
  const target = sessionKey.slice(idx + 1);
  switch (prefix) {
    case "dm":
      return "user-dm.jsonl";
    case "internal":
      return `agent-${target}.jsonl`;
    case "ch":
      return `channel-${target}.jsonl`;
    default:
      return "unknown.jsonl";
  }
}

/** Append a session entry to a JSONL file, rotating if needed. */
export function appendSession(
  baseDir: string,
  agentName: string,
  filename: string,
  entry: SessionEntry,
): void {
  const dir = join(baseDir, "agents", agentName, "sessions");
  mkdirSync(dir, { recursive: true });
  const filePath = join(dir, filename);
  const line = JSON.stringify(entry) + "\n";
  appendFileSync(filePath, line, "utf-8");
  rotate(filePath);
}

function rotate(filePath: string): void {
  let content: string;
  try {
    content = readFileSync(filePath, "utf-8");
  } catch {
    return;
  }
  const lines = content.split("\n").filter((l) => l.length > 0);
  if (lines.length <= MAX_LINES) return;
  const kept = lines.slice(-KEEP_LINES);
  const tmp = filePath + ".tmp";
  writeFileSync(tmp, kept.join("\n") + "\n", "utf-8");
  renameSync(tmp, filePath);
}

/** Delete all session files for a fired agent and cross-references from other agents. */
export function deleteAgentSessions(
  baseDir: string,
  agentName: string,
): void {
  // 1. Remove the fired agent's entire sessions directory
  const agentSessionDir = join(baseDir, "agents", agentName, "sessions");
  rmSync(agentSessionDir, { recursive: true, force: true });

  // 2. Remove session files in other agents referencing the fired agent
  const agentsDir = join(baseDir, "agents");
  if (!existsSync(agentsDir)) return;
  const targetFile = `agent-${agentName}.jsonl`;
  for (const dir of readdirSync(agentsDir)) {
    if (dir === agentName) continue;
    const sessionPath = join(agentsDir, dir, "sessions", targetFile);
    rmSync(sessionPath, { force: true });
  }
}
