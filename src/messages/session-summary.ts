import { completeSimple } from "@mariozechner/pi-ai";
import type { Model } from "@mariozechner/pi-ai";
import type { MessageStore } from "./message-store.js";

const SUMMARY_THRESHOLD = 50;
const SUMMARY_WINDOW = 50;

/**
 * If unsummarized turns exceed SUMMARY_THRESHOLD, generate a summary for the
 * most recent SUMMARY_WINDOW turns beyond the last checkpoint.
 */
export async function maybeTriggerSummary(
  store: MessageStore,
  sessionKey: string,
  model: Model<any>,
  apiKey: string,
): Promise<void> {
  const latest = store.latestSummary(sessionKey);
  const afterSeq = latest?.to_seq ?? 0;

  const tail = store.querySessionTail(
    sessionKey,
    afterSeq,
    SUMMARY_THRESHOLD,
  );
  if (tail.length < SUMMARY_THRESHOLD) return;

  const window = tail.slice(0, SUMMARY_WINDOW);
  const lastMsg = window[window.length - 1]!;
  const fromSeq = window[0]!.session_seq;
  const toSeq = lastMsg.session_seq;

  const text = window
    .map((m) => `[${m.role}] ${m.text.slice(0, 500)}`)
    .join("\n");

  const result = await completeSimple(
    model,
    {
      systemPrompt:
        "Summarize the following conversation turns into a concise paragraph. " +
        "Focus on key decisions, outcomes, and action items. Be factual.",
      messages: [{ role: "user", content: text, timestamp: Date.now() }],
    },
    { apiKey },
  );

  const summary =
    result.content
      .filter((c: { type: string }) => c.type === "text")
      .map((c: { type: string; text?: string }) => c.text ?? "")
      .join("") || "";

  if (!summary) return;

  store.saveSummary({
    session_key: sessionKey,
    from_seq: fromSeq,
    to_seq: toSeq,
    summary,
    model: model.name,
  });
}
