import { test } from "node:test";
import assert from "node:assert/strict";
import { createSlot } from "../src/slot.ts";

test("second acquire fails until release", () => {
  const slot = createSlot();
  assert.equal(slot.tryAcquire("a"), true);
  assert.equal(slot.tryAcquire("b"), false);
  slot.release("a");
  assert.equal(slot.tryAcquire("b"), true);
});

test("fifo dequeue after release", () => {
  const slot = createSlot();
  slot.tryAcquire("a");
  slot.enqueue("b");
  slot.enqueue("c");
  slot.release("a");
  assert.equal(slot.dequeue(), "b");
  assert.equal(slot.dequeue(), "c");
  assert.equal(slot.dequeue(), null);
});

test("enqueue of holder is ignored", () => {
  const slot = createSlot();
  slot.tryAcquire("a");
  slot.enqueue("a");
  slot.release("a");
  assert.equal(slot.dequeue(), null);
});
