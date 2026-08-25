import { test } from "node:test";
import assert from "node:assert/strict";
import { assembleIssueContext } from "../src/event.ts";

test("assembleIssueContext uses title description state comments when promptContext empty", () => {
  const ctx = assembleIssueContext({
    identifier: "JHJ-66",
    title: "상세 이후 방향성",
    description: "뒤로가기 버튼을 고친다",
    state: "Backlog",
    comments: "### Jane\n확인",
  });
  assert.match(ctx, /JHJ-66/);
  assert.match(ctx, /상세 이후 방향성/);
  assert.match(ctx, /뒤로가기/);
  assert.match(ctx, /Backlog/);
  assert.match(ctx, /확인/);
});

test("assembleIssueContext prepends title/state onto existing promptContext", () => {
  const ctx = assembleIssueContext({
    identifier: "JHJ-1",
    title: "로그인",
    state: "Todo",
    promptContext: "<issue>fix login</issue>",
    description: "should not replace promptContext",
  });
  assert.match(ctx, /Title: 로그인/);
  assert.match(ctx, /State: Todo/);
  assert.match(ctx, /fix login/);
  assert.equal(ctx.includes("should not replace"), false);
});
