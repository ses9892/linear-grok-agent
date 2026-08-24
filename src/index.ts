import { readFileSync, existsSync, openSync, unlinkSync, closeSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { loadConfig } from "./config.ts";
import { createGrokPort } from "./spawnGrok.ts";
import { createLinearPort, exchangeOAuthCode } from "./linear.ts";
import { handleWebhook } from "./orchestrator.ts";
import { reclaimZombies } from "./reclaim.ts";
import { createServer } from "./server.ts";
import { createSlot } from "./slot.ts";
import { openStore } from "./store.ts";
import { acquireWorktreeLock } from "./worktree.ts";

const root = process.env.LINEAR_GROK_AGENT_ROOT ?? join(process.cwd());

function git(args: string[]) {
  const result = spawnSync("git", args, { encoding: "utf8" });
  return { stdout: result.stdout ?? "", status: result.status ?? 1 };
}

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function main(): Promise<void> {
  const cfg = loadConfig(readFileSync(join(root, "config.toml"), "utf8"));
  const store = openStore(join(root, "state.sqlite"));
  const slot = createSlot();
  const tokenPath = join(root, "token.json");
  const grok = createGrokPort();
  const lockWorktree = (worktreePath: string) =>
    acquireWorktreeLock(worktreePath, (lockPath) => {
      const fd = openSync(lockPath, "wx");
      return {
        close() {
          closeSync(fd);
          try {
            unlinkSync(lockPath);
          } catch {
            /* ignore */
          }
        },
      };
    });

  const server = createServer({
    webhookSecret: cfg.linearWebhookSecret,
    onOAuthCode: async (code) => {
      await exchangeOAuthCode({
        clientId: cfg.linearClientId,
        clientSecret: cfg.linearClientSecret,
        redirectUri: `${cfg.publicBaseUrl}/oauth/callback`,
        code,
        tokenPath,
      });
    },
    onWebhook: async (eventId, _raw, body) => {
      if (!existsSync(tokenPath)) {
        console.error("token.json missing; complete OAuth first");
        return;
      }
      const token = (JSON.parse(readFileSync(tokenPath, "utf8")) as { access_token: string })
        .access_token;
      const linear = createLinearPort(token);
      const result = await handleWebhook({
        store,
        slot,
        linear,
        grok,
        agentRoot: root,
        repoPath: cfg.repoPath,
        git,
        exists: existsSync,
        lockWorktree,
        eventId,
        body,
      });
      if (result.running) {
        await result.running;
      }
    },
  });

  if (existsSync(tokenPath)) {
    const token = (JSON.parse(readFileSync(tokenPath, "utf8")) as { access_token: string })
      .access_token;
    await reclaimZombies(store, createLinearPort(token), alive);
  }

  server.listen(cfg.bindPort, cfg.bindHost, () => {
    console.log(`linear-grok-agent listening on ${cfg.bindHost}:${cfg.bindPort}`);
  });
}

void main().catch((err) => {
  console.error(err);
  process.exit(1);
});
