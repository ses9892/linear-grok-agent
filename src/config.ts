import { parse } from "smol-toml";

export type AgentConfig = {
  linearClientId: string;
  linearClientSecret: string;
  linearWebhookSecret: string;
  appUserId: string;
  repoPath: string;
  bindHost: string;
  bindPort: number;
  publicBaseUrl: string;
  maxRunning: number;
};

export function loadConfig(tomlText: string): AgentConfig {
  const obj = parse(tomlText) as Record<string, unknown>;
  const missing: string[] = [];
  const take = (key: string): string => {
    const v = obj[key];
    if (typeof v !== "string" || v.length === 0) {
      missing.push(key);
      return "";
    }
    return v;
  };
  const linearClientId = take("linear_client_id");
  const linearClientSecret = take("linear_client_secret");
  const linearWebhookSecret = take("linear_webhook_secret");
  const appUserId = take("app_user_id");
  const repoPath = take("repo_path");
  const bindHost = take("bind_host");
  const publicBaseUrl = take("public_base_url");
  const bindPort = obj.bind_port;
  if (typeof bindPort !== "number") {
    missing.push("bind_port");
  }
  const maxRunningRaw = obj.max_running;
  const maxRunning =
    maxRunningRaw === undefined || maxRunningRaw === null
      ? 5
      : typeof maxRunningRaw === "number"
        ? maxRunningRaw
        : Number.NaN;
  if (!Number.isInteger(maxRunning) || maxRunning < 1) {
    missing.push("max_running");
  }
  if (missing.length > 0) {
    throw new Error(`missing config key ${missing.join(", ")}`);
  }
  return {
    linearClientId,
    linearClientSecret,
    linearWebhookSecret,
    appUserId,
    repoPath,
    bindHost,
    bindPort: bindPort as number,
    publicBaseUrl,
    maxRunning,
  };
}
