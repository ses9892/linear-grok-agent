import { test } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { createServer } from "../src/server.ts";

function post(
  port: number,
  path: string,
  headers: Record<string, string>,
  body: Buffer,
): Promise<{ status: number; text: string }> {
  return new Promise((resolve, reject) => {
    import("node:http").then((http) => {
      const req = http.request(
        { hostname: "127.0.0.1", port, path, method: "POST", headers },
        (res) => {
          const chunks: Buffer[] = [];
          res.on("data", (c) => chunks.push(c as Buffer));
          res.on("end", () =>
            resolve({ status: res.statusCode ?? 0, text: Buffer.concat(chunks).toString("utf8") }),
          );
        },
      );
      req.on("error", reject);
      req.end(body);
    });
  });
}

function get(port: number, path: string): Promise<{ status: number; text: string }> {
  return new Promise((resolve, reject) => {
    import("node:http").then((http) => {
      const req = http.request({ hostname: "127.0.0.1", port, path, method: "GET" }, (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c) => chunks.push(c as Buffer));
        res.on("end", () =>
          resolve({ status: res.statusCode ?? 0, text: Buffer.concat(chunks).toString("utf8") }),
        );
      });
      req.on("error", reject);
      req.end();
    });
  });
}

test("missing signature is 401", async () => {
  const calls: unknown[] = [];
  const server = createServer({
    webhookSecret: "s",
    onWebhook: async () => {
      calls.push(1);
    },
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const addr = server.address();
  assert.ok(addr && typeof addr === "object");
  const port = addr.port;
  const raw = Buffer.from(`{"webhookTimestamp":${Date.now()}}`);
  const res = await post(port, "/webhook", { "content-type": "application/json" }, raw);
  assert.equal(res.status, 401);
  assert.equal(calls.length, 0);
  server.close();
});

test("valid signature is 200 and onWebhook called", async () => {
  const calls: { eventId: string }[] = [];
  const server = createServer({
    webhookSecret: "s",
    onWebhook: async (eventId) => {
      calls.push({ eventId });
    },
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const addr = server.address();
  assert.ok(addr && typeof addr === "object");
  const port = addr.port;
  const raw = Buffer.from(`{"webhookTimestamp":${Date.now()}}`);
  const sig = createHmac("sha256", "s").update(raw).digest("hex");
  const res = await post(
    port,
    "/webhook",
    {
      "content-type": "application/json",
      "linear-signature": sig,
      "linear-delivery": "deliv-9",
    },
    raw,
  );
  assert.equal(res.status, 200);
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(calls[0]?.eventId, "deliv-9");
  server.close();
});

test("health is 200", async () => {
  const server = createServer({ webhookSecret: "s", onWebhook: async () => {} });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const addr = server.address();
  assert.ok(addr && typeof addr === "object");
  const res = await get(addr.port, "/health");
  assert.equal(res.status, 200);
  server.close();
});
