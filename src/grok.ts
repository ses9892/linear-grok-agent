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
  ];
  if (opts.resumeSessionId) {
    argv.push("--resume", opts.resumeSessionId);
  }
  return argv;
}

export type GrokStreamHandlers = {
  onThought(text: string): void;
  onAction(title: string): void;
};

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
        handlers.onAction(title);
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

export function buildIssuePrompt(opts: { promptContext: string; userText: string }): string {
  return [
    "You are Grok Build handling a Linear issue for SeedSiteKeeper.",
    "Only modify SeedSiteKeeper at the worktree cwd. Do not touch other repositories.",
    "Follow AGENTS.md and DEV_PROCESS.md in the worktree.",
    "Do not change the Linear assignee. You are the delegate, not the owner.",
    "",
    "Linear promptContext:",
    opts.promptContext,
    "",
    opts.userText ? `User message:\n${opts.userText}` : "",
    "",
    "If you cannot proceed without the user, do not guess. End with:",
    `{"agent":"elicitation","body":"..."}`,
    "When done with a GitHub PR, end with:",
    `{"agent":"complete","prUrl":"https://github.com/.../pull/N","summary":"..."}`,
    "When done with no code change, end with prUrl null:",
    `{"agent":"complete","prUrl":null,"summary":"..."}`,
    "On failure, end with:",
    `{"agent":"error","body":"..."}`,
  ].join("\n");
}
