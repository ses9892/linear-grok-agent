import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openStore, type IssueRecord } from "../src/store.ts";
import { createSlot } from "../src/slot.ts";
import type { GrokPort, LinearPort } from "../src/ports.ts";
import { handleWebhook } from "../src/orchestrator.ts";

function createdBody(issueId = "iss-1", identifier = "JHJ-1") {
  return {
    type: "AgentSessionEvent",
    action: "created",
    agentSession: {
      id: "ses-1",
      issue: { id: issueId, identifier },
      promptContext: `<issue identifier="${identifier}">fix login</issue>`,
    },
  };
}

function completeText(prUrl: string | null = "https://github.com/x/y/pull/1") {
  return JSON.stringify({ agent: "complete", prUrl, summary: "ok" });
}

function rec(over: Partial<IssueRecord> = {}): IssueRecord {
  return {
    issueId: "iss-1",
    issueIdentifier: "JHJ-1",
    linearAgentSessionId: "ses-1",
    grokSessionId: "g-1",
    worktreePath: "/agent/worktrees/JHJ-1",
    branch: "feat/jhj-1",
    status: "complete",
    queuedPrompt: "",
    pid: null,
    updatedAt: 1,
    ...over,
  };
}

type RunCall = {
  prompt: string;
  cwd: string;
  resumeSessionId?: string;
};

function setup() {
  const db = join(mkdtempSync(join(tmpdir(), "lg-")), "s.sqlite");
  const store = openStore(db);
  const slot = createSlot();
  const thoughts: string[] = [];
  const errors: string[] = [];
  const responses: string[] = [];
  const urls: string[][] = [];
  const linear: LinearPort = {
    async thought(_s, body) {
      thoughts.push(body);
    },
    async action() {},
    async elicitation() {},
    async response(_s, body) {
      responses.push(body);
    },
    async error(_s, body) {
      errors.push(body);
    },
    async setExternalUrls(_s, list) {
      urls.push(list.map((u) => u.url));
    },
  };
  const runs: RunCall[] = [];
  let grokImpl: GrokPort["run"] = async (opts) => {
    runs.push({ prompt: opts.prompt, cwd: opts.cwd, resumeSessionId: opts.resumeSessionId });
    opts.onThought("thinking");
    return { sessionId: "g-1", text: completeText(), exitCode: 0, pid: 4242 };
  };
  const grok: GrokPort = {
    run: (opts) => grokImpl(opts),
  };
  function setGrok(impl: GrokPort["run"]) {
    grokImpl = impl;
  }
  const gitCalls: string[][] = [];
  const ctx = {
    store,
    slot,
    linear,
    grok,
    agentRoot: "/agent",
    repoPath: "/repo",
    git: (args: string[]) => {
      gitCalls.push(args);
      return { stdout: "", status: 0 };
    },
    exists: (path: string) => path === "/agent/worktrees/JHJ-1" && store.getByIssueId("iss-1")?.worktreePath === path,
    lockWorktree: () => () => {},
  };
  return { ctx, store, runs, thoughts, errors, responses, urls, gitCalls, setGrok };
}

test("created with no record starts grok without resume", async () => {
  const { ctx, runs, thoughts } = setup();
  const result = await handleWebhook({
    ...ctx,
    exists: () => false,
    eventId: "d1",
    body: createdBody(),
  });
  await result.running;
  assert.equal(runs.length, 1);
  assert.equal(runs[0].resumeSessionId, undefined);
  assert.ok(thoughts.some((t) => t.includes("시작합니다")));
});

test("second created while running queues then resumes", async () => {
  const { ctx, runs, setGrok, store } = setup();
  let releaseFirst!: () => void;
  const firstGate = new Promise<void>((r) => {
    releaseFirst = r;
  });
  setGrok(async (opts) => {
    runs.push({ prompt: opts.prompt, cwd: opts.cwd, resumeSessionId: opts.resumeSessionId });
    if (runs.length === 1) await firstGate;
    return { sessionId: "g-1", text: completeText(), exitCode: 0, pid: 1 };
  });
  const r1 = await handleWebhook({ ...ctx, exists: () => false, eventId: "d1", body: createdBody() });
  const r2 = await handleWebhook({ ...ctx, exists: () => false, eventId: "d2", body: createdBody() });
  assert.equal(runs.length, 1);
  assert.ok((store.getByIssueId("iss-1")?.queuedPrompt.length ?? 0) > 0);
  releaseFirst();
  await r1.running;
  await r2.running;
  assert.equal(runs.length, 2);
  assert.equal(runs[1].resumeSessionId, "g-1");
});

test("awaiting_input prompted resumes grok session", async () => {
  const { ctx, store, runs } = setup();
  store.upsert(
    rec({
      status: "awaiting_input",
      grokSessionId: "g-old",
      worktreePath: "/agent/worktrees/JHJ-1",
    }),
  );
  const result = await handleWebhook({
    ...ctx,
    exists: (p) => p === "/agent/worktrees/JHJ-1",
    eventId: "d3",
    body: {
      type: "AgentSessionEvent",
      action: "prompted",
      agentSession: {
        id: "ses-1",
        issue: { id: "iss-1", identifier: "JHJ-1" },
        promptContext: "ctx",
      },
      agentActivity: { body: "서울" },
    },
  });
  await result.running;
  assert.equal(runs[0].resumeSessionId, "g-old");
  assert.match(runs[0].prompt, /서울/);
});

test("complete then created reuses branch and resumes", async () => {
  const { ctx, store, runs, gitCalls } = setup();
  store.upsert(rec({ status: "complete" }));
  const result = await handleWebhook({
    ...ctx,
    exists: (p) => p === "/agent/worktrees/JHJ-1",
    eventId: "d4",
    body: createdBody(),
  });
  await result.running;
  assert.equal(runs[0].resumeSessionId, "g-1");
  assert.equal(gitCalls.length, 0);
});

test("second issue waits in fifo then starts", async () => {
  const { ctx, runs, thoughts, setGrok } = setup();
  let releaseFirst!: () => void;
  const firstGate = new Promise<void>((r) => {
    releaseFirst = r;
  });
  setGrok(async (opts) => {
    runs.push({ prompt: opts.prompt, cwd: opts.cwd, resumeSessionId: opts.resumeSessionId });
    if (opts.cwd.endsWith("JHJ-1") && runs.filter((r) => r.cwd.endsWith("JHJ-1")).length === 1) {
      await firstGate;
    }
    return { sessionId: "g-x", text: completeText(), exitCode: 0, pid: 1 };
  });
  const r1 = await handleWebhook({
    ...ctx,
    exists: () => false,
    eventId: "e1",
    body: createdBody("iss-1", "JHJ-1"),
  });
  const r2 = await handleWebhook({
    ...ctx,
    exists: () => false,
    eventId: "e2",
    body: createdBody("iss-2", "JHJ-2"),
  });
  assert.equal(runs.length, 1);
  assert.ok(thoughts.some((t) => t.includes("JHJ-1") && t.includes("작업 중")));
  releaseFirst();
  await r1.running;
  await r2.running;
  assert.ok(runs.some((r) => r.cwd.endsWith("JHJ-2")));
});

test("grok exit 0 without marker is error", async () => {
  const { ctx, store, errors, setGrok } = setup();
  setGrok(async (opts) => {
    opts.onThought("x");
    return { sessionId: "g-1", text: "no marker here", exitCode: 0, pid: 1 };
  });
  const result = await handleWebhook({
    ...ctx,
    exists: () => false,
    eventId: "d5",
    body: createdBody(),
  });
  await result.running;
  assert.equal(store.getByIssueId("iss-1")?.status, "error");
  assert.ok(errors.length > 0);
});

test("duplicate eventId does not run grok", async () => {
  const { ctx, runs } = setup();
  const first = await handleWebhook({
    ...ctx,
    exists: () => false,
    eventId: "same",
    body: createdBody(),
  });
  await first.running;
  const second = await handleWebhook({
    ...ctx,
    exists: () => false,
    eventId: "same",
    body: createdBody(),
  });
  assert.equal(second.httpNote, "duplicate");
  assert.equal(runs.length, 1);
});
