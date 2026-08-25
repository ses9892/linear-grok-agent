export type LinearPort = {
  thought(sessionId: string, body: string): Promise<void>;
  action(sessionId: string, action: string, parameter: string): Promise<void>;
  elicitation(sessionId: string, body: string): Promise<void>;
  response(sessionId: string, body: string): Promise<void>;
  error(sessionId: string, body: string): Promise<void>;
  setExternalUrls(sessionId: string, urls: { label: string; url: string }[]): Promise<void>;
};

export type GrokPort = {
  run(opts: {
    prompt: string;
    cwd: string;
    resumeSessionId?: string;
    onThought(text: string): void;
    onAction(title: string, parameter: string): void;
    onStart?(pid: number): void;
    signal?: AbortSignal;
    env?: Record<string, string>;
  }): Promise<{
    sessionId: string | null;
    text: string;
    exitCode: number;
    pid: number;
    aborted: boolean;
  }>;
};
