import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openStore, type IssueRecord } from "../src/store.ts";

function rec(over: Partial<IssueRecord> = {}): IssueRecord {
  return {
    issueId: "iss-1",
    issueIdentifier: "JHJ-1",
    linearAgentSessionId: "ses-1",
    grokSessionId: null,
    worktreePath: null,
    branch: null,
    status: "running",
    queuedPrompt: "",
    pid: 12,
    updatedAt: 1,
    ...over,
  };
}

test("upsert and getByIssueId", () => {
  const db = join(mkdtempSync(join(tmpdir(), "lg-")), "s.sqlite");
  const store = openStore(db);
  store.upsert(rec());
  assert.equal(store.getByIssueId("iss-1")?.issueIdentifier, "JHJ-1");
});

test("markEventProcessed is idempotent", () => {
  const db = join(mkdtempSync(join(tmpdir(), "lg-")), "s.sqlite");
  const store = openStore(db);
  assert.equal(store.markEventProcessed("deliv-1"), true);
  assert.equal(store.markEventProcessed("deliv-1"), false);
});

test("append and take queued prompt", () => {
  const db = join(mkdtempSync(join(tmpdir(), "lg-")), "s.sqlite");
  const store = openStore(db);
  store.upsert(rec());
  store.appendQueuedPrompt("iss-1", "first");
  store.appendQueuedPrompt("iss-1", "second");
  assert.equal(store.takeQueuedPrompt("iss-1"), "first\nsecond");
  assert.equal(store.takeQueuedPrompt("iss-1"), "");
});

test("listByStatus returns queued", () => {
  const db = join(mkdtempSync(join(tmpdir(), "lg-")), "s.sqlite");
  const store = openStore(db);
  store.upsert(rec());
  store.upsert(rec({ issueId: "iss-2", status: "queued", pid: null }));
  assert.equal(store.listByStatus("queued").length, 1);
});

test("listRunning returns only running", () => {
  const db = join(mkdtempSync(join(tmpdir(), "lg-")), "s.sqlite");
  const store = openStore(db);
  store.upsert(rec());
  store.upsert(rec({ issueId: "iss-2", status: "awaiting_input", pid: null }));
  assert.equal(store.listRunning().length, 1);
});
