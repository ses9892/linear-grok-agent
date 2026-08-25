export type AgentEvent = {
  action: "created" | "prompted";
  eventId: string;
  issueId: string;
  issueIdentifier: string;
  linearAgentSessionId: string;
  promptContext: string;
  userText: string;
  issueTitle: string;
  issueDescription: string;
  issueState: string;
  stop: boolean;
};

function asRecord(value: unknown): Record<string, unknown> | null {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function str(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function stateName(issue: Record<string, unknown>): string {
  const state = asRecord(issue.state);
  if (state && typeof state.name === "string") return state.name;
  return str(issue.state);
}

export function assembleIssueContext(opts: {
  identifier: string;
  title?: string;
  description?: string;
  state?: string;
  promptContext?: string;
  comments?: string;
}): string {
  if (opts.promptContext && opts.promptContext.trim().length > 0) {
    const extra = [
      opts.title ? `Title: ${opts.title}` : "",
      opts.state ? `State: ${opts.state}` : "",
    ]
      .filter(Boolean)
      .join("\n");
    return extra ? `${extra}\n\n${opts.promptContext.trim()}` : opts.promptContext.trim();
  }
  const parts = [
    `# ${opts.identifier}${opts.title ? ` ${opts.title}` : ""}`,
    opts.state ? `State: ${opts.state}` : "",
    opts.description ? `## Description\n${opts.description}` : "",
    opts.comments ? `## Comments\n${opts.comments}` : "",
  ].filter((p) => p.length > 0);
  return parts.join("\n\n");
}

export function parseAgentSessionEvent(body: unknown, eventId: string): AgentEvent | null {
  const root = asRecord(body);
  if (!root) return null;
  if (root.type && root.type !== "AgentSessionEvent") {
    return null;
  }
  const action = root.action;
  if (action !== "created" && action !== "prompted") {
    return null;
  }
  const session = asRecord(root.agentSession) || asRecord(root.data);
  if (!session || typeof session.id !== "string") {
    return null;
  }
  const issue = asRecord(session.issue);
  if (!issue || typeof issue.id !== "string" || typeof issue.identifier !== "string") {
    return null;
  }
  const promptContextRaw =
    str(session.promptContext) || str(root.promptContext) || str(issue.promptContext);
  const issueTitle = str(issue.title);
  const issueDescription = str(issue.description);
  const issueState = stateName(issue);
  const promptContext = assembleIssueContext({
    identifier: issue.identifier,
    title: issueTitle,
    description: issueDescription,
    state: issueState,
    promptContext: promptContextRaw,
  });
  const activity = asRecord(root.agentActivity);
  const userText = activity && typeof activity.body === "string" ? activity.body : "";
  const stop = str(activity?.signal) === "stop";
  return {
    action,
    eventId,
    issueId: issue.id,
    issueIdentifier: issue.identifier,
    linearAgentSessionId: session.id,
    promptContext,
    userText,
    issueTitle,
    issueDescription,
    issueState,
    stop,
  };
}
