import { test } from "node:test";
import assert from "node:assert/strict";
import { createThoughtBuffer } from "../src/thoughtBuffer.ts";

test("flush joins short chunks into one thought", () => {
  const out: string[] = [];
  const buf = createThoughtBuffer({ emit: (t) => out.push(t) });
  buf.push("Let");
  buf.push(" ");
  buf.push("me");
  buf.push(" ");
  buf.push("check");
  buf.flush();
  assert.deepEqual(out, ["Let me check"]);
});

test("ignores empty flush", () => {
  const out: string[] = [];
  const buf = createThoughtBuffer({ emit: (t) => out.push(t) });
  buf.flush();
  assert.deepEqual(out, []);
});

test("sentence end after minChars flushes", () => {
  const out: string[] = [];
  const buf = createThoughtBuffer({ emit: (t) => out.push(t), minChars: 10 });
  buf.push("I will inspect the worktree now.");
  assert.equal(out.length, 1);
  assert.match(out[0], /worktree/);
});

test("maxChars flushes before growing forever", () => {
  const out: string[] = [];
  const buf = createThoughtBuffer({ emit: (t) => out.push(t), maxChars: 20 });
  buf.push("abcdefghij");
  buf.push("klmnopqrstuvwxyz");
  assert.ok(out.length >= 1);
  buf.flush();
  assert.equal(out.join("").includes("abcdefghijklmnopqrstuvwxyz"), true);
});
