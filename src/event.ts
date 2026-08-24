export type AgentEvent = {
  action: "created" | "prompted";
  eventId: string;
  issueId: string;
  issueIdentifier: string;
  linearAgentSessionId: string;
  promptContext: string;
  userText: string;
};

function asRecord(value: unknown): Record<string, unknown> | null {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

export function parseAgentSessionEvent(body: unknown, eventId: string): AgentEvent | null {
  const root = asRecord(body);
  if (!root) return null;
  const type = root.type;
  if (type !== "AgentSessionEvent" && type !== undefined) {
    // Some payloads omit type; still require action + agentSession.
  }
  if (root.type && root.type !== "AgentSessionEvent") {
    return null;
  }
  const action = root.action;
  if (action !== "created" && action !== "prompted") {
    return null;
  }
  const session = asRecord(root.agentSession);
  if (!session || typeof session.id !== "string") {
    return null;
  }
  const issue = asRecord(session.issue);
  if (!issue || typeof issue.id !== "string" || typeof issue.identifier !== "string") {
    return null;
  }
  const promptContext = typeof session.promptContext === "string" ? session.promptContext : "";
  const activity = asRecord(root.agentActivity);
  const userText = activity && typeof activity.body === "string" ? activity.body : "";
  return {
    action,
    eventId,
    issueId: issue.id,
    issueIdentifier: issue.identifier,
    linearAgentSessionId: session.id,
    promptContext,
    userText,
  };
}
