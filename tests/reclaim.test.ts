import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openStore, type IssueRecord } from "../src/store.ts";
import type { LinearPort } from "../src/ports.ts";
import { reclaimZombies } from "../src/reclaim.ts";

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
    pid: 999,
    updatedAt: 1,
    ...over,
  };
}

function fakeLinear() {
  const errors: string[] = [];
  const linear: LinearPort = {
    async thought() {},
    async action() {},
    async elicitation() {},
    async response() {},
    async error(_s, body) {
      errors.push(body);
    },
    async setExternalUrls() {},
  };
  return { linear, errors };
}

test("reclaim: running pid 999, alive false → error", async () => {
  const db = join(mkdtempSync(join(tmpdir(), "lg-")), "s.sqlite");
  const store = openStore(db);
  store.upsert(rec());
  const { linear, errors } = fakeLinear();
  await reclaimZombies(store, linear, () => false);
  assert.equal(store.getByIssueId("iss-1")?.status, "error");
  assert.match(errors[0] ?? "", /맥이 잠겨 중단됨/);
});
