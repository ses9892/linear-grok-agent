import { writeFile } from "node:fs/promises";
import type { LinearPort } from "./ports.ts";

async function graphql(
  token: string,
  query: string,
  variables: Record<string, unknown>,
): Promise<void> {
  const res = await fetch("https://api.linear.app/graphql", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ query, variables }),
  });
  if (!res.ok) {
    throw new Error(`Linear GraphQL HTTP ${res.status}`);
  }
  const json = (await res.json()) as { errors?: { message: string }[] };
  if (json.errors?.length) {
    throw new Error(json.errors.map((e) => e.message).join("; "));
  }
}

const ACTIVITY = `
mutation AgentActivityCreate($input: AgentActivityCreateInput!) {
  agentActivityCreate(input: $input) { success }
}
`;

const SESSION_UPDATE = `
mutation AgentSessionUpdate($id: String!, $input: AgentSessionUpdateInput!) {
  agentSessionUpdate(id: $id, input: $input) { success }
}
`;

export function createLinearPort(token: string): LinearPort {
  return {
    async thought(sessionId, body) {
      await graphql(token, ACTIVITY, {
        input: { agentSessionId: sessionId, content: { type: "thought", body } },
      });
    },
    async action(sessionId, action, parameter) {
      await graphql(token, ACTIVITY, {
        input: {
          agentSessionId: sessionId,
          content: { type: "action", action, parameter },
        },
      });
    },
    async elicitation(sessionId, body) {
      await graphql(token, ACTIVITY, {
        input: { agentSessionId: sessionId, content: { type: "elicitation", body } },
      });
    },
    async response(sessionId, body) {
      await graphql(token, ACTIVITY, {
        input: { agentSessionId: sessionId, content: { type: "response", body } },
      });
    },
    async error(sessionId, body) {
      await graphql(token, ACTIVITY, {
        input: { agentSessionId: sessionId, content: { type: "error", body } },
      });
    },
    async setExternalUrls(sessionId, urls) {
      await graphql(token, SESSION_UPDATE, {
        id: sessionId,
        input: { externalUrls: urls },
      });
    },
  };
}

export async function exchangeOAuthCode(opts: {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  code: string;
  tokenPath: string;
}): Promise<string> {
  const res = await fetch("https://api.linear.app/oauth/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      client_id: opts.clientId,
      client_secret: opts.clientSecret,
      redirect_uri: opts.redirectUri,
      code: opts.code,
    }),
  });
  if (!res.ok) {
    throw new Error(`Linear OAuth HTTP ${res.status}`);
  }
  const json = (await res.json()) as { access_token?: string };
  if (!json.access_token) {
    throw new Error("Linear OAuth missing access_token");
  }
  await writeFile(opts.tokenPath, JSON.stringify({ access_token: json.access_token }), "utf8");
  return json.access_token;
}
