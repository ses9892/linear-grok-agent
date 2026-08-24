import type { IssueRecord } from "./store.ts";
import type { AgentEvent } from "./event.ts";

export type Decision =
  | { kind: "start" }
  | { kind: "queuePrompt"; text: string }
  | { kind: "resume"; text: string };

function decisionText(event: AgentEvent): string {
  return event.userText.length > 0 ? event.userText : event.promptContext;
}

export function decide(record: IssueRecord | null, event: AgentEvent): Decision {
  if (record === null) {
    return { kind: "start" };
  }
  const text = decisionText(event);
  if (record.status === "running") {
    return { kind: "queuePrompt", text };
  }
  return { kind: "resume", text };
}
