import { test } from "node:test";
import assert from "node:assert/strict";
import {
  acquireWorktreeLock,
  branchName,
  worktreeDir,
  ensureWorktree,
} from "../src/worktree.ts";

test("branchName lowercases identifier", () => {
  assert.equal(branchName("JHJ-12"), "feat/jhj-12");
});

test("worktreeDir joins agentRoot and identifier", () => {
  assert.equal(worktreeDir("/agent", "JHJ-1"), "/agent/worktrees/JHJ-1");
});

test("reuses existingPath without git add", () => {
  const calls: string[][] = [];
  const result = ensureWorktree({
    repoPath: "/repo",
    agentRoot: "/agent",
    issueIdentifier: "JHJ-1",
    existingPath: "/agent/worktrees/JHJ-1",
    git: (args) => {
      calls.push(args);
      return { stdout: "", status: 0 };
    },
    exists: () => true,
  });
  assert.equal(result.created, false);
  assert.equal(calls.length, 0);
});

test("creates worktree when no existing path", () => {
  const calls: string[][] = [];
  const result = ensureWorktree({
    repoPath: "/repo",
    agentRoot: "/agent",
    issueIdentifier: "JHJ-1",
    existingPath: null,
    git: (args) => {
      calls.push(args);
      return { stdout: "", status: 0 };
    },
    exists: () => false,
  });
  assert.equal(result.created, true);
  assert.equal(result.branch, "feat/jhj-1");
  assert.deepEqual(calls[0], [
    "-C",
    "/repo",
    "worktree",
    "add",
    "-b",
    "feat/jhj-1",
    "/agent/worktrees/JHJ-1",
  ]);
});

test("second lock throws", () => {
  const held: string[] = [];
  const close = acquireWorktreeLock("/wt", (lockPath) => {
    if (held.includes(lockPath)) throw new Error("EEXIST");
    held.push(lockPath);
    return { close() {} };
  });
  assert.throws(() =>
    acquireWorktreeLock("/wt", (lockPath) => {
      if (held.includes(lockPath)) throw new Error("EEXIST");
      held.push(lockPath);
      return { close() {} };
    }),
  );
  close();
});
