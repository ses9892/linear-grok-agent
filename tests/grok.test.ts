import { test } from "node:test";
import assert from "node:assert/strict";
import { grokArgv, consumeGrokStream, buildIssuePrompt, toolCallParameter } from "../src/grok.ts";

test("argv always includes grok-4.6 high yolo streaming-json", () => {
  const argv = grokArgv({ prompt: "p", cwd: "/tmp/wt" });
  assert.deepEqual(argv.slice(0, 2), ["grok", "-p"]);
  assert.ok(argv.includes("grok-4.6"));
  assert.ok(argv.includes("high"));
  assert.ok(argv.includes("--yolo"));
  assert.ok(argv.includes("streaming-json"));
  assert.ok(argv.includes("MCPTool(linear__*)"));
  assert.equal(argv.includes("--resume"), false);
});

test("argv resume flag", () => {
  const argv = grokArgv({ prompt: "p", cwd: "/tmp/wt", resumeSessionId: "abc" });
  const i = argv.indexOf("--resume");
  assert.equal(argv[i + 1], "abc");
});

test("consumeGrokStream concatenates text and sessionId from end", () => {
  const thoughts: string[] = [];
  const actions: string[] = [];
  const { text, sessionId } = consumeGrokStream(
    [
      JSON.stringify({ type: "thought", data: "hmm" }),
      JSON.stringify({ type: "tool_call", title: "Read" }),
      JSON.stringify({ type: "text", data: "hello " }),
      JSON.stringify({
        type: "text",
        data: "{\"agent\":\"complete\",\"prUrl\":null,\"summary\":\"ok\"}",
      }),
      JSON.stringify({ type: "end", sessionId: "sid-1" }),
    ],
    { onThought: (t) => thoughts.push(t), onAction: (t) => actions.push(t) },
  );
  assert.equal(thoughts[0], "hmm");
  assert.equal(actions[0], "Read");
  assert.match(text, /agent":"complete"/);
  assert.equal(sessionId, "sid-1");
});

test("buildIssuePrompt requires elicitation marker and seed path", () => {
  const p = buildIssuePrompt({
    promptContext: "CTX",
    userText: "답: 로그인",
    helperPath: "/agent/bin/linear-as-grok",
  });
  assert.match(p, /CTX/);
  assert.match(p, /답: 로그인/);
  assert.match(p, /elicitation/);
  assert.match(p, /DEV_PROCESS/);
  assert.match(p, /Never use Linear MCP/);
  assert.match(p, /linear-as-grok/);
  assert.match(p, /<<'EOF'/);
  assert.match(p, /description/);
  assert.match(p, /state /);
});

test("toolCallParameter prefers path", () => {
  assert.equal(toolCallParameter({ path: "src/a.ts" }), "src/a.ts");
});

test("consumeGrokStream passes tool parameter", () => {
  const actions: string[] = [];
  consumeGrokStream(
    [JSON.stringify({ type: "tool_call", toolName: "read_file", rawInput: { path: "a.ts" } })],
    { onThought() {}, onAction: (t, p) => actions.push(`${t}:${p}`) },
  );
  assert.equal(actions[0], "read_file:a.ts");
});

test("consumeGrokStream uses locations path when rawInput missing", () => {
  const actions: string[] = [];
  consumeGrokStream(
    [
      JSON.stringify({
        type: "tool_call",
        title: "Read",
        locations: [{ path: "src/main.rs" }],
      }),
    ],
    { onThought() {}, onAction: (t, p) => actions.push(`${t}:${p}`) },
  );
  assert.equal(actions[0], "Read:src/main.rs");
});

test("consumeGrokStream ignores tool_call_update", () => {
  const actions: string[] = [];
  consumeGrokStream(
    [
      JSON.stringify({ type: "tool_call", title: "Read", rawInput: { path: "a.ts" } }),
      JSON.stringify({ type: "tool_call_update", status: "completed", rawOutput: { lines: 1 } }),
    ],
    { onThought() {}, onAction: (t, p) => actions.push(`${t}:${p}`) },
  );
  assert.deepEqual(actions, ["Read:a.ts"]);
});
