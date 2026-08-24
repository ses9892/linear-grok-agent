import { createHmac, timingSafeEqual } from "node:crypto";

export function verifyLinearSignature(opts: {
  secret: string;
  rawBody: Buffer;
  headerSignature: string | undefined;
  webhookTimestamp: number | undefined;
  nowMs: number;
}): boolean {
  const { secret, rawBody, headerSignature, webhookTimestamp, nowMs } = opts;
  if (typeof headerSignature !== "string" || headerSignature.length === 0) {
    return false;
  }
  if (typeof webhookTimestamp !== "number") {
    return false;
  }
  if (Math.abs(nowMs - webhookTimestamp) > 60_000) {
    return false;
  }
  let headerBuf: Buffer;
  try {
    headerBuf = Buffer.from(headerSignature, "hex");
  } catch {
    return false;
  }
  const computed = createHmac("sha256", secret).update(rawBody).digest();
  if (headerBuf.length !== computed.length) {
    return false;
  }
  return timingSafeEqual(headerBuf, computed);
}
