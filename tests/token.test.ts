import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  exchangeOAuthCode,
  loadValidAccessToken,
  oauthAuthorizeUrl,
  tokenFromOAuthResponse,
} from "../src/linear.ts";

test("tokenFromOAuthResponse keeps refresh_token and expires_at", () => {
  const t = tokenFromOAuthResponse(
    { access_token: "a", refresh_token: "r", expires_in: 100 },
    1_000,
  );
  assert.equal(t.access_token, "a");
  assert.equal(t.refresh_token, "r");
  assert.equal(t.expires_at, 101_000);
});

test("oauthAuthorizeUrl uses grokbot callback", () => {
  const url = oauthAuthorizeUrl("cid", "https://grokbot.win");
  assert.match(url, /client_id=cid/);
  assert.match(url, /grokbot\.win/);
  assert.match(url, /actor=app/);
});

test("exchangeOAuthCode persists refresh_token", async () => {
  const dir = mkdtempSync(join(tmpdir(), "tok-"));
  const tokenPath = join(dir, "token.json");
  await exchangeOAuthCode({
    clientId: "id",
    clientSecret: "sec",
    redirectUri: "https://grokbot.win/oauth/callback",
    code: "abc",
    tokenPath,
    fetchImpl: async () =>
      new Response(
        JSON.stringify({
          access_token: "acc",
          refresh_token: "ref",
          expires_in: 86400,
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
  });
  const saved = JSON.parse(readFileSync(tokenPath, "utf8")) as { refresh_token?: string };
  assert.equal(saved.refresh_token, "ref");
});

test("loadValidAccessToken refreshes when expired", async () => {
  const dir = mkdtempSync(join(tmpdir(), "tok-"));
  const tokenPath = join(dir, "token.json");
  writeFileSync(
    tokenPath,
    JSON.stringify({ access_token: "old", refresh_token: "ref", expires_at: 10 }),
  );
  const token = await loadValidAccessToken({
    tokenPath,
    clientId: "id",
    clientSecret: "sec",
    nowMs: 100_000,
    fetchImpl: async () =>
      new Response(
        JSON.stringify({
          access_token: "new",
          refresh_token: "ref2",
          expires_in: 86400,
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
  });
  assert.equal(token, "new");
  const saved = JSON.parse(readFileSync(tokenPath, "utf8")) as { access_token: string };
  assert.equal(saved.access_token, "new");
});
