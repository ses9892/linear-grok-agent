export type AgentMarker =
  | { agent: "elicitation"; body: string }
  | { agent: "complete"; prUrl: string | null; summary: string }
  | { agent: "error"; body: string };

function asMarker(obj: unknown): AgentMarker | null {
  if (obj === null || typeof obj !== "object" || Array.isArray(obj)) {
    return null;
  }
  const rec = obj as Record<string, unknown>;
  if (rec.agent === "elicitation" && typeof rec.body === "string") {
    return { agent: "elicitation", body: rec.body };
  }
  if (
    rec.agent === "complete" &&
    typeof rec.summary === "string" &&
    (rec.prUrl === null || typeof rec.prUrl === "string")
  ) {
    return { agent: "complete", prUrl: rec.prUrl as string | null, summary: rec.summary };
  }
  if (rec.agent === "error" && typeof rec.body === "string") {
    return { agent: "error", body: rec.body };
  }
  return null;
}

export function parseAgentMarker(text: string): AgentMarker | null {
  const trimmed = text.trim();
  for (let start = trimmed.lastIndexOf("{"); start >= 0; start = trimmed.lastIndexOf("{", start - 1)) {
    for (let end = trimmed.length; end > start; end--) {
      try {
        const obj = JSON.parse(trimmed.slice(start, end)) as unknown;
        const marker = asMarker(obj);
        if (marker) {
          return marker;
        }
      } catch {
        continue;
      }
    }
  }
  return null;
}
