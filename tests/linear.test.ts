import { test } from "node:test";
import assert from "node:assert/strict";
import { matchWorkflowState } from "../src/linear.ts";

test("matchWorkflowState is case and space insensitive", () => {
  const states = [
    { id: "1", name: "Todo" },
    { id: "2", name: "In Progress" },
    { id: "3", name: "Done" },
  ];
  assert.equal(matchWorkflowState(states, "todo")?.id, "1");
  assert.equal(matchWorkflowState(states, "inprogress")?.id, "2");
  assert.equal(matchWorkflowState(states, "In Progress")?.id, "2");
  assert.equal(matchWorkflowState(states, "Nope"), undefined);
});
