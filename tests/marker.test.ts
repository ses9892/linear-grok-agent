import { test } from "node:test";
import assert from "node:assert/strict";
import { parseAgentMarker } from "../src/marker.ts";

test("parses elicitation as last json object", () => {
  const text = `working...\n{"agent":"elicitation","body":"어느 화면인가요?"}`;
  assert.deepEqual(parseAgentMarker(text), {
    agent: "elicitation",
    body: "어느 화면인가요?",
  });
});

test("parses complete with prUrl", () => {
  const text = `{"agent":"complete","prUrl":"https://github.com/org/repo/pull/1","summary":"done"}`;
  assert.equal(parseAgentMarker(text)?.agent, "complete");
});

test("parses complete with null prUrl", () => {
  const m = parseAgentMarker(`{"agent":"complete","prUrl":null,"summary":"변경 없음"}`);
  assert.deepEqual(m, { agent: "complete", prUrl: null, summary: "변경 없음" });
});

test("parses error", () => {
  assert.equal(parseAgentMarker(`{"agent":"error","body":"boom"}`)?.agent, "error");
});

test("returns null when no agent marker", () => {
  assert.equal(parseAgentMarker("just text\n{\"foo\":1}"), null);
});

test("uses the last json object", () => {
  const text = `{"agent":"error","body":"old"}\n{"agent":"complete","prUrl":null,"summary":"ok"}`;
  assert.equal(parseAgentMarker(text)?.agent, "complete");
});
