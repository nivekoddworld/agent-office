export interface PersistedInbox {
  seq: number;
  id: string;
  from_agent: string;
  to_agent: string;
  type: "prompt" | "steer";
  payload: string;
  priority: number;
  created_at_ms: number;
  request_id: string | null;
  session_key?: string | null;
  source_kind?: string | null;
  channel?: string | null;
}

export interface DmRecord {
  id: number;
  agent: string;
  role: "user" | "assistant";
  text: string;
  ts_ms: number;
  request_id: string | null;
}

export interface SessionMessage {
  id: number;
  session_key: string;
  session_seq: number;
  role: string;
  text: string;
  ts_ms: number;
  request_id: string | null;
  agent_name: string | null;
}

export interface SessionSummary {
  id: number;
  session_key: string;
  from_seq: number;
  to_seq: number;
  summary: string;
  model: string;
  created_at_ms: number;
}

export interface SessionSearchResult {
  kind: "summary" | "message";
  session_key: string;
  snippet: string;
  ts_ms: number;
  rank: number;
}
