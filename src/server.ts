import { createServer as createHttpServer, type IncomingMessage, type ServerResponse } from "node:http";
import { verifyLinearSignature } from "./signature.ts";

export type ServerOpts = {
  webhookSecret: string;
  onWebhook: (eventId: string, rawBody: Buffer, body: unknown) => Promise<void>;
  onOAuthCode?: (code: string) => Promise<void>;
};

function readRaw(req: IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (c) => chunks.push(c as Buffer));
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

function send(res: ServerResponse, status: number, text = ""): void {
  res.statusCode = status;
  res.end(text);
}

export function createServer(opts: ServerOpts) {
  return createHttpServer((req, res) => {
    void handle(req, res, opts);
  });
}

async function handle(req: IncomingMessage, res: ServerResponse, opts: ServerOpts): Promise<void> {
  const url = new URL(req.url ?? "/", "http://127.0.0.1");
  if (req.method === "GET" && url.pathname === "/health") {
    send(res, 200, "ok");
    return;
  }
  if (req.method === "GET" && url.pathname === "/oauth/callback") {
    const code = url.searchParams.get("code");
    if (!code) {
      send(res, 400, "missing code");
      return;
    }
    try {
      await opts.onOAuthCode?.(code);
      send(res, 200, "ok");
    } catch (err) {
      send(res, 500, String(err));
    }
    return;
  }
  if (req.method === "POST" && url.pathname === "/webhook") {
    const rawBody = await readRaw(req);
    let parsed: unknown = null;
    try {
      parsed = JSON.parse(rawBody.toString("utf8")) as unknown;
    } catch {
      send(res, 401);
      return;
    }
    const webhookTimestamp =
      parsed !== null &&
      typeof parsed === "object" &&
      !Array.isArray(parsed) &&
      typeof (parsed as { webhookTimestamp?: unknown }).webhookTimestamp === "number"
        ? (parsed as { webhookTimestamp: number }).webhookTimestamp
        : undefined;
    const headerSignature = req.headers["linear-signature"];
    const sig = Array.isArray(headerSignature) ? headerSignature[0] : headerSignature;
    const ok = verifyLinearSignature({
      secret: opts.webhookSecret,
      rawBody,
      headerSignature: sig,
      webhookTimestamp,
      nowMs: Date.now(),
    });
    if (!ok) {
      send(res, 401);
      return;
    }
    const delivery = req.headers["linear-delivery"];
    const eventId = (Array.isArray(delivery) ? delivery[0] : delivery) || "unknown";
    send(res, 200);
    void opts.onWebhook(eventId, rawBody, parsed).catch((err) => {
      console.error("webhook handler failed", err);
    });
    return;
  }
  send(res, 404);
}
