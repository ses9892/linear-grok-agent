import { test } from "node:test";
import assert from "node:assert/strict";
import { loadConfig } from "../src/config.ts";

test("loadConfig reads required keys", () => {
  const cfg = loadConfig(`
linear_client_id = "id"
linear_client_secret = "sec"
linear_webhook_secret = "wh"
app_user_id = "app"
repo_path = "/Users/jangjinho/SeedAi/SeedAI_SiteKeeper/SeedSiteKeeper"
bind_host = "127.0.0.1"
bind_port = 8787
public_base_url = "https://example.trycloudflare.com"
`);
  assert.equal(cfg.repoPath, "/Users/jangjinho/SeedAi/SeedAI_SiteKeeper/SeedSiteKeeper");
  assert.equal(cfg.bindPort, 8787);
  assert.equal(cfg.maxRunning, 5);
});

test("loadConfig throws when repo_path missing", () => {
  assert.throws(() => loadConfig(`linear_client_id = "id"`), /repo_path/);
});
