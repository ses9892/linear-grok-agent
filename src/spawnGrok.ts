import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { consumeGrokStream, grokArgv } from "./grok.ts";
import type { GrokPort } from "./ports.ts";

export function createGrokPort(): GrokPort {
  return {
    async run(opts) {
      const argv = grokArgv({
        prompt: opts.prompt,
        cwd: opts.cwd,
        resumeSessionId: opts.resumeSessionId,
      });
      const child = spawn(argv[0], argv.slice(1), {
        cwd: opts.cwd,
        stdio: ["ignore", "pipe", "pipe"],
      });
      const pid = child.pid ?? 0;
      const lines: string[] = [];
      const rl = createInterface({ input: child.stdout });
      for await (const line of rl) {
        lines.push(line);
        consumeGrokStream([line], {
          onThought: opts.onThought,
          onAction: opts.onAction,
        });
      }
      const exitCode: number = await new Promise((resolve) => {
        child.on("close", (code) => resolve(code ?? 1));
      });
      const { text, sessionId } = consumeGrokStream(lines, {
        onThought() {},
        onAction() {},
      });
      return { sessionId, text, exitCode, pid };
    },
  };
}
