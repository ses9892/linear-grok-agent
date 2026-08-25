import { join } from "node:path";
import { decide } from "./dispatch.ts";
import { assembleIssueContext, parseAgentSessionEvent } from "./event.ts";
import { buildIssuePrompt } from "./grok.ts";
import { downloadLinearImages } from "./images.ts";
import type { IssueSnapshot } from "./linear.ts";
import { parseAgentMarker } from "./marker.ts";
import type { GrokPort, LinearPort } from "./ports.ts";
import type { Store } from "./store.ts";
import type { Slot } from "./slot.ts";
import { createThoughtBuffer } from "./thoughtBuffer.ts";
import { ensureWorktree, type GitRunner } from "./worktree.ts";

export type HandleWebhookOpts = {
  store: Store;
  slot: Slot;
  linear: LinearPort;
  grok: GrokPort;
  agentRoot: string;
  repoPath: string;
  git: GitRunner;
  exists: (path: string) => boolean;
  lockWorktree: (worktreePath: string) => () => void;
  eventId: string;
  body: unknown;
  token?: string;
  loadIssue?: (issueId: string) => Promise<IssueSnapshot>;
};

const webhookContextByIssue = new Map<string, string>();

export async function handleWebhook(
  opts: HandleWebhookOpts,
): Promise<{ httpNote: "ok" | "duplicate" | "ignored"; running?: Promise<void> }> {
  const { store, slot, linear, eventId, body } = opts;
  if (!store.markEventProcessed(eventId)) {
    return { httpNote: "duplicate" };
  }
  const event = parseAgentSessionEvent(body, eventId);
  if (!event) {
    return { httpNote: "ignored" };
  }
  webhookContextByIssue.set(event.issueId, event.promptContext);

  const existing = store.getByIssueId(event.issueId);
  await linear.thought(
    event.linearAgentSessionId,
    existing
      ? `Grok이 ${event.issueIdentifier} 작업을 이어서 진행합니다`
      : `Grok이 ${event.issueIdentifier} 작업을 시작합니다`,
  );

  const decision = decide(existing, event);
  const now = Date.now();
  if (decision.kind === "start") {
    store.upsert({
      issueId: event.issueId,
      issueIdentifier: event.issueIdentifier,
      linearAgentSessionId: event.linearAgentSessionId,
      grokSessionId: null,
      worktreePath: null,
      branch: null,
      status: "running",
      queuedPrompt: "",
      pid: null,
      updatedAt: now,
    });
    store.appendQueuedPrompt(
      event.issueId,
      opts.loadIssue ? event.userText || "start" : event.userText || event.promptContext,
    );
  } else if (decision.kind === "queuePrompt") {
    store.appendQueuedPrompt(event.issueId, decision.text);
    return { httpNote: "ok" };
  } else {
    store.upsert({
      ...existing!,
      linearAgentSessionId: event.linearAgentSessionId,
      issueIdentifier: event.issueIdentifier,
      updatedAt: now,
    });
    store.appendQueuedPrompt(event.issueId, decision.text);
  }

  if (!slot.tryAcquire(event.issueId)) {
    slot.enqueue(event.issueId);
    const holder = slot.holder();
    const holderRec = holder ? store.getByIssueId(holder) : null;
    await linear.thought(
      event.linearAgentSessionId,
      `지금 ${holderRec?.issueIdentifier ?? holder ?? "다른 이슈"} 작업 중`,
    );
    return { httpNote: "ok" };
  }

  const running = runLoop(opts, event.issueId, event.promptContext);
  return { httpNote: "ok", running };
}

async function runLoop(
  opts: HandleWebhookOpts,
  issueId: string,
  fallbackContext: string,
): Promise<void> {
  try {
    await runOneIssue(opts, issueId, fallbackContext);
  } finally {
    opts.slot.release(issueId);
    const next = opts.slot.dequeue();
    if (next && opts.slot.tryAcquire(next)) {
      const nextRec = opts.store.getByIssueId(next);
      await runLoop(opts, next, nextRec?.queuedPrompt ?? fallbackContext);
    }
  }
}

function helperBin(agentRoot: string): string {
  return join(agentRoot, "bin/linear-as-grok");
}

async function runOneIssue(
  opts: HandleWebhookOpts,
  issueId: string,
  fallbackContext: string,
): Promise<void> {
  const { store, linear, grok, agentRoot, repoPath, git, exists, lockWorktree } = opts;
  while (true) {
    const record = store.getByIssueId(issueId);
    if (!record) return;
    const wt = ensureWorktree({
      repoPath,
      agentRoot,
      issueIdentifier: record.issueIdentifier,
      existingPath: record.worktreePath,
      git,
      exists,
    });
    store.upsert({
      ...record,
      worktreePath: wt.worktreePath,
      branch: wt.branch,
      status: "running",
      updatedAt: Date.now(),
    });
    const unlock = lockWorktree(wt.worktreePath);
    try {
      const queued = store.takeQueuedPrompt(issueId);
      const latest = store.getByIssueId(issueId)!;
      const webhookFallback = webhookContextByIssue.get(issueId) || fallbackContext;
      let promptContext = webhookFallback || queued;
      let userText = "";
      const helperPath = helperBin(opts.agentRoot);
      if (opts.loadIssue) {
        try {
          const snap = await opts.loadIssue(issueId);
          promptContext = assembleIssueContext({
            identifier: snap.identifier,
            title: snap.title,
            description: snap.description,
            state: snap.state,
            comments: snap.comments,
          });
          userText = !queued || queued === "start" ? "" : queued;
        } catch (err) {
          console.error("loadIssue failed", err);
          promptContext = webhookFallback || (queued === "start" ? "" : queued);
          userText = queued && queued !== "start" && queued !== webhookFallback ? queued : "";
        }
      } else {
        userText = queued && queued !== webhookFallback && queued !== "start" ? queued : "";
        if (!promptContext) promptContext = queued;
      }
      if (opts.token && promptContext) {
        try {
          const imaged = await downloadLinearImages({
            markdown: promptContext,
            destDir: join(opts.agentRoot, "issue-images", latest.issueIdentifier),
            token: opts.token,
          });
          promptContext = imaged.markdown;
          if (imaged.files.length > 0) {
            promptContext += `\n\n## Local screenshots\n${imaged.files.map((f) => `- ${f}`).join("\n")}`;
          }
        } catch (err) {
          console.error("downloadLinearImages failed", err);
        }
      }
      const thoughts = createThoughtBuffer({
        emit: (text) => {
          void linear.thought(latest.linearAgentSessionId, text);
        },
      });
      const result = await grok.run({
        prompt: buildIssuePrompt({
          promptContext,
          userText,
          helperPath,
        }),
        cwd: wt.worktreePath,
        resumeSessionId: latest.grokSessionId ?? undefined,
        onThought: (text) => {
          thoughts.push(text);
        },
        onAction: (title, parameter) => {
          thoughts.flush();
          void linear.action(latest.linearAgentSessionId, title, parameter);
        },
        env: opts.token
          ? {
              LINEAR_GROK_TOKEN: opts.token,
              LINEAR_ISSUE_ID: issueId,
              LINEAR_GROK_HELPER: helperPath,
            }
          : undefined,
      });
      thoughts.flush();
      const after = store.getByIssueId(issueId)!;
      store.upsert({
        ...after,
        grokSessionId: result.sessionId ?? after.grokSessionId,
        pid: result.pid,
        worktreePath: wt.worktreePath,
        branch: wt.branch,
        updatedAt: Date.now(),
      });
      const leftover = store.takeQueuedPrompt(issueId);
      if (leftover) {
        store.appendQueuedPrompt(issueId, leftover);
        continue;
      }
      const marker = parseAgentMarker(result.text);
      const current = store.getByIssueId(issueId)!;
      if (result.exitCode !== 0 || !marker) {
        const body =
          result.exitCode !== 0
            ? `Grok exited ${result.exitCode}${current.branch ? ` (branch ${current.branch})` : ""}`
            : "Grok ended without an agent marker";
        store.upsert({ ...current, status: "error", pid: null, updatedAt: Date.now() });
        await linear.error(current.linearAgentSessionId, body);
        return;
      }
      if (marker.agent === "elicitation") {
        store.upsert({ ...current, status: "awaiting_input", pid: null, updatedAt: Date.now() });
        await linear.elicitation(current.linearAgentSessionId, marker.body);
        return;
      }
      if (marker.agent === "complete") {
        store.upsert({ ...current, status: "complete", pid: null, updatedAt: Date.now() });
        await linear.response(current.linearAgentSessionId, marker.summary);
        if (marker.prUrl) {
          await linear.setExternalUrls(current.linearAgentSessionId, [
            { label: "PR", url: marker.prUrl },
          ]);
        }
        return;
      }
      store.upsert({ ...current, status: "error", pid: null, updatedAt: Date.now() });
      await linear.error(current.linearAgentSessionId, marker.body);
      return;
    } finally {
      unlock();
    }
  }
}
