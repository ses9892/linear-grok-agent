import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveBody } from "../src/linearAsGrok.ts";

test("resolveBody prefers argv, uses stdin for - or empty", () => {
  assert.equal(resolveBody(["hello", "world"], "stdin"), "hello world");
  assert.equal(resolveBody(["-"], "from stdin"), "from stdin");
  assert.equal(resolveBody([], "piped"), "piped");
  assert.equal(resolveBody([], ""), "");
});
