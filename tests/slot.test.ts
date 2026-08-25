import { test } from "node:test";
import assert from "node:assert/strict";
import { createSlot } from "../src/slot.ts";

test("second acquire fails until release when limit is 1", () => {
  const slot = createSlot(1);
  assert.equal(slot.tryAcquire("a"), true);
  assert.equal(slot.tryAcquire("b"), false);
  slot.release("a");
  assert.equal(slot.tryAcquire("b"), true);
});

test("fifo dequeue after release", () => {
  const slot = createSlot(1);
  slot.tryAcquire("a");
  slot.enqueue("b");
  slot.enqueue("c");
  slot.release("a");
  assert.equal(slot.dequeue(), "b");
  assert.equal(slot.dequeue(), "c");
  assert.equal(slot.dequeue(), null);
});

test("enqueue of holder is ignored", () => {
  const slot = createSlot(1);
  slot.tryAcquire("a");
  slot.enqueue("a");
  slot.release("a");
  assert.equal(slot.dequeue(), null);
});

test("default limit is 5", () => {
  const slot = createSlot();
  assert.equal(slot.limit, 5);
  for (const id of ["a", "b", "c", "d", "e"]) {
    assert.equal(slot.tryAcquire(id), true);
  }
  assert.equal(slot.tryAcquire("f"), false);
  slot.enqueue("f");
  assert.equal(slot.queuePosition("f"), 1);
  slot.release("a");
  assert.equal(slot.dequeue(), "f");
});

test("remove drops a queued issue", () => {
  const slot = createSlot(1);
  slot.tryAcquire("a");
  slot.enqueue("b");
  slot.enqueue("c");
  slot.remove("b");
  slot.release("a");
  assert.equal(slot.dequeue(), "c");
});
