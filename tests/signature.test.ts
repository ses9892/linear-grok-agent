import { test } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { verifyLinearSignature } from "../src/signature.ts";

const secret = "whsec";
const rawBody = Buffer.from(`{"webhookTimestamp":1000}`, "utf8");
const sig = createHmac("sha256", secret).update(rawBody).digest("hex");

test("accepts matching signature within 60s", () => {
  assert.equal(
    verifyLinearSignature({
      secret,
      rawBody,
      headerSignature: sig,
      webhookTimestamp: 1000,
      nowMs: 1000,
    }),
    true,
  );
});

test("rejects bad signature", () => {
  assert.equal(
    verifyLinearSignature({
      secret,
      rawBody,
      headerSignature: "00",
      webhookTimestamp: 1000,
      nowMs: 1000,
    }),
    false,
  );
});

test("rejects stale timestamp", () => {
  assert.equal(
    verifyLinearSignature({
      secret,
      rawBody,
      headerSignature: sig,
      webhookTimestamp: 1000,
      nowMs: 1000 + 61_000,
    }),
    false,
  );
});
