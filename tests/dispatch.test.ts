import { test } from "node:test";
import assert from "node:assert/strict";
import { parseAgentSessionEvent } from "../src/event.ts";
import { decide } from "../src/dispatch.ts";
import type { IssueRecord } from "../src/store.ts";

const createdBody = {
  type: "AgentSessionEvent",
  action: "created",
  agentSession: {
    id: "ses-1",
    issue: { id: "iss-1", identifier: "JHJ-1" },
    promptContext: "<issue identifier=\"JHJ-1\">fix login</issue>",
  },
};

test("parseAgentSessionEvent reads created payload", () => {
  const event = parseAgentSessionEvent(createdBody, "deliv-1");
  assert.equal(event?.action, "created");
  assert.equal(event?.issueId, "iss-1");
  assert.equal(event?.issueIdentifier, "JHJ-1");
  assert.equal(event?.linearAgentSessionId, "ses-1");
  assert.match(event?.promptContext ?? "", /fix login/);
  assert.equal(event?.userText, "");
});

test("parseAgentSessionEvent reads prompted body", () => {
  const event = parseAgentSessionEvent(
    {
      type: "AgentSessionEvent",
      action: "prompted",
      agentSession: {
        id: "ses-1",
        issue: { id: "iss-1", identifier: "JHJ-1" },
        promptContext: "ctx",
      },
      agentActivity: { body: "서울" },
    },
    "deliv-2",
  );
  assert.equal(event?.action, "prompted");
  assert.equal(event?.userText, "서울");
});

test("parseAgentSessionEvent returns null when incomplete", () => {
  assert.equal(parseAgentSessionEvent({ type: "Issue" }, "x"), null);
});

function rec(over: Partial<IssueRecord> = {}): IssueRecord {
  return {
    issueId: "iss-1",
    issueIdentifier: "JHJ-1",
    linearAgentSessionId: "ses-1",
    grokSessionId: "g-1",
    worktreePath: "/wt",
    branch: "feat/jhj-1",
    status: "running",
    queuedPrompt: "",
    pid: 1,
    updatedAt: 1,
    ...over,
  };
}

const event = {
  action: "created" as const,
  eventId: "e1",
  issueId: "iss-1",
  issueIdentifier: "JHJ-1",
  linearAgentSessionId: "ses-1",
  promptContext: "CTX",
  userText: "",
};

test("decide start when no record", () => {
  assert.deepEqual(decide(null, event), { kind: "start" });
});

test("decide queuePrompt when running", () => {
  assert.deepEqual(decide(rec({ status: "running" }), { ...event, userText: "more" }), {
    kind: "queuePrompt",
    text: "more",
  });
});

test("decide resume for awaiting complete and error", () => {
  assert.equal(decide(rec({ status: "awaiting_input" }), event).kind, "resume");
  assert.equal(decide(rec({ status: "complete" }), event).kind, "resume");
  assert.equal(decide(rec({ status: "error" }), event).kind, "resume");
});

test("decide uses promptContext when userText empty", () => {
  const d = decide(rec({ status: "awaiting_input" }), event);
  assert.deepEqual(d, { kind: "resume", text: "CTX" });
});
