import { readFileSync, existsSync, openSync, unlinkSync, closeSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { loadConfig } from "./config.ts";
import { createGrokPort } from "./spawnGrok.ts";
import {
  createLinearPort,
  exchangeOAuthCode,
  fetchIssueSnapshot,
  loadValidAccessToken,
  oauthAuthorizeUrl,
} from "./linear.ts";
import { handleWebhook, pumpSlots } from "./orchestrator.ts";
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
  const slot = createSlot(cfg.maxRunning);
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
      let token: string;
      try {
        token = await loadValidAccessToken({
          tokenPath,
          clientId: cfg.linearClientId,
          clientSecret: cfg.linearClientSecret,
        });
      } catch (err) {
        console.error("Linear token missing/expired. Re-authorize:", oauthAuthorizeUrl(cfg.linearClientId, cfg.publicBaseUrl));
        console.error(err);
        return;
      }
      const linear = createLinearPort(token);
      try {
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
          token,
          loadIssue: (issueId) => fetchIssueSnapshot(token, issueId),
        });
        void result.running?.catch((err) => {
          console.error("grok run failed", err);
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.includes("401") || msg.includes("Authentication")) {
          console.error("Linear GraphQL 401. Re-authorize:", oauthAuthorizeUrl(cfg.linearClientId, cfg.publicBaseUrl));
        }
        console.error("webhook handler failed", err);
      }
    },
  });

  if (existsSync(tokenPath)) {
    try {
      const token = await loadValidAccessToken({
        tokenPath,
        clientId: cfg.linearClientId,
        clientSecret: cfg.linearClientSecret,
      });
      const linear = createLinearPort(token);
      await reclaimZombies(store, linear, alive);
      for (const rec of store.listByStatus("queued")) {
        slot.enqueue(rec.issueId);
      }
      pumpSlots({
        store,
        slot,
        linear,
        grok,
        agentRoot: root,
        repoPath: cfg.repoPath,
        git,
        exists: existsSync,
        lockWorktree,
        token,
        loadIssue: (issueId) => fetchIssueSnapshot(token, issueId),
      });
    } catch (err) {
      console.error("Linear token missing/expired. Re-authorize:", oauthAuthorizeUrl(cfg.linearClientId, cfg.publicBaseUrl));
      console.error(err);
    }
  }

  server.listen(cfg.bindPort, cfg.bindHost, () => {
    console.log(`linear-grok-agent listening on ${cfg.bindHost}:${cfg.bindPort}`);
    console.log("OAuth:", oauthAuthorizeUrl(cfg.linearClientId, cfg.publicBaseUrl));
  });
}

void main().catch((err) => {
  console.error(err);
  process.exit(1);
});

