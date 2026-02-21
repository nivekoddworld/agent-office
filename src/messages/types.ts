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
}

export interface DmRecord {
  id: number;
  agent: string;
  role: "user" | "assistant";
  text: string;
  ts_ms: number;
  request_id: string | null;
}
