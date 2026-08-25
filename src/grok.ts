export function grokArgv(opts: {
  prompt: string;
  cwd: string;
  resumeSessionId?: string;
}): string[] {
  const argv = [
    "grok",
    "-p",
    opts.prompt,
    "--cwd",
    opts.cwd,
    "-m",
    "grok-4.6",
    "--effort",
    "high",
    "--yolo",
    "--output-format",
    "streaming-json",
    "--deny",
    "MCPTool(linear__*)",
    "--deny",
    "mcp__linear",
  ];
  if (opts.resumeSessionId) {
    argv.push("--resume", opts.resumeSessionId);
  }
  return argv;
}

export type GrokStreamHandlers = {
  onThought(text: string): void;
  onAction(title: string, parameter: string): void;
};

export function toolCallParameter(rawInput: unknown): string {
  if (rawInput === null || rawInput === undefined) return "";
  if (typeof rawInput === "string") return rawInput.slice(0, 240);
  if (typeof rawInput === "object" && !Array.isArray(rawInput)) {
    const o = rawInput as Record<string, unknown>;
    for (const key of [
      "path",
      "file",
      "command",
      "query",
      "url",
      "target_file",
      "file_path",
      "pattern",
      "glob",
    ]) {
      if (typeof o[key] === "string" && o[key]) return String(o[key]).slice(0, 240);
    }
  }
  try {
    return JSON.stringify(rawInput).slice(0, 240);
  } catch {
    return "";
  }
}

function locationPath(event: Record<string, unknown>): string {
  if (!Array.isArray(event.locations) || event.locations.length === 0) return "";
  const loc = event.locations[0];
  if (loc && typeof loc === "object" && !Array.isArray(loc)) {
    const path = (loc as Record<string, unknown>).path;
    if (typeof path === "string") return path.slice(0, 240);
  }
  return "";
}

export function consumeGrokStream(
  lines: string[],
  handlers: GrokStreamHandlers,
): { text: string; sessionId: string | null } {
  let text = "";
  let sessionId: string | null = null;
  for (const line of lines) {
    if (!line.trim()) continue;
    try {
      const event = JSON.parse(line) as Record<string, unknown>;
      if (event.type === "thought" && typeof event.data === "string") {
        handlers.onThought(event.data);
      } else if (event.type === "tool_call") {
        const title =
          (typeof event.title === "string" && event.title) ||
          (typeof event.toolName === "string" && event.toolName) ||
          "tool";
        const parameter = toolCallParameter(event.rawInput ?? event.input) || locationPath(event);
        handlers.onAction(title, parameter);
      } else if (event.type === "text" && typeof event.data === "string") {
        text += event.data;
      } else if (event.type === "end" && typeof event.sessionId === "string") {
        sessionId = event.sessionId;
      }
    } catch {
      continue;
    }
  }
  return { text, sessionId };
}

export function buildIssuePrompt(opts: {
  promptContext: string;
  userText: string;
  helperPath?: string;
}): string {
  const helper = opts.helperPath ?? "$LINEAR_GROK_HELPER";
  return [
    "You are Grok Build handling a Linear issue for SeedSiteKeeper.",
    "Only modify SeedSiteKeeper at the worktree cwd. Do not touch other repositories.",
    "Follow AGENTS.md and DEV_PROCESS.md in the worktree.",
    "Do not change the Linear assignee. You are the delegate, not the owner.",
    "Never use Linear MCP tools (those run as the human user).",
    "LINEAR_GROK_TOKEN and LINEAR_ISSUE_ID are already in the environment.",
    "To change THIS Linear issue (description, comment, state) as the Grok app, run the helper. Do not cd away from the worktree.",
    `Helper: ${helper}`,
    "Also available as $LINEAR_GROK_HELPER.",
    `  "${helper}" get`,
    `  "${helper}" comment <<'EOF'`,
    "  markdown comment as Grok",
    "  EOF",
    `  "${helper}" description <<'EOF'`,
    "  full replacement markdown",
    "  EOF",
    `  "${helper}" title "new title"`,
    `  "${helper}" state "Todo|In Progress|Done|Backlog|Canceled|Duplicate"`,
    "Local screenshot paths under Linear promptContext are already downloaded; read them as absolute files.",
    'Put the user-visible session summary only in the final {"agent":...} JSON marker.',
    "",
    "Linear promptContext:",
    opts.promptContext,
    "",
    opts.userText ? `User message:\n${opts.userText}` : "",
    "",
    "If you cannot proceed without the user, do not guess. End with:",
    '{"agent":"elicitation","body":"..."}',
    "When done with a GitHub PR, end with:",
    '{"agent":"complete","prUrl":"https://github.com/.../pull/N","summary":"..."}',
    "When done with no code change, end with prUrl null:",
    '{"agent":"complete","prUrl":null,"summary":"..."}',
    "On failure, end with:",
    '{"agent":"error","body":"..."}',
  ].join("\n");
}
