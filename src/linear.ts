import { readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import type { LinearPort } from "./ports.ts";

export async function graphql(
  token: string,
  query: string,
  variables: Record<string, unknown> = {},
): Promise<unknown> {
  const res = await fetch("https://api.linear.app/graphql", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ query, variables }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Linear GraphQL HTTP ${res.status}${body ? `: ${body.slice(0, 200)}` : ""}`);
  }
  const json = (await res.json()) as { data?: unknown; errors?: { message: string }[] };
  if (json.errors?.length) {
    throw new Error(json.errors.map((e) => e.message).join("; "));
  }
  return json.data;
}

export type IssueSnapshot = {
  id: string;
  identifier: string;
  title: string;
  description: string;
  state: string;
  comments: string;
};

export async function fetchIssueSnapshot(token: string, issueId: string): Promise<IssueSnapshot> {
  const data = (await graphql(
    token,
    `query IssueSnapshot($id: String!) {
      issue(id: $id) {
        id
        identifier
        title
        description
        state { name }
        comments(last: 50) {
          nodes { body createdAt user { name } }
        }
      }
    }`,
    { id: issueId },
  )) as {
    issue?: {
      id: string;
      identifier: string;
      title?: string | null;
      description?: string | null;
      state?: { name?: string } | null;
      comments?: { nodes?: { body?: string; createdAt?: string; user?: { name?: string } | null }[] };
    };
  };
  const issue = data.issue;
  if (!issue) {
    throw new Error(`Linear issue not found: ${issueId}`);
  }
  const comments = [...(issue.comments?.nodes ?? [])]
    .sort((a, b) => String(a.createdAt ?? "").localeCompare(String(b.createdAt ?? "")))
    .map((c) => {
      const who = c.user?.name ?? "unknown";
      const when = c.createdAt ?? "";
      return `### ${who} ${when}\n${c.body ?? ""}`;
    })
    .join("\n\n");
  return {
    id: issue.id,
    identifier: issue.identifier,
    title: issue.title ?? "",
    description: issue.description ?? "",
    state: issue.state?.name ?? "",
    comments,
  };
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

export type LinearTokenFile = {
  access_token: string;
  refresh_token?: string;
  expires_at?: number;
};

export function oauthAuthorizeUrl(clientId: string, publicBaseUrl: string): string {
  const redirect = `${publicBaseUrl.replace(/\/$/, "")}/oauth/callback`;
  const q = new URLSearchParams({
    response_type: "code",
    client_id: clientId,
    redirect_uri: redirect,
    scope: "read,write,app:assignable,app:mentionable",
    actor: "app",
    state: "install",
  });
  return `https://linear.app/oauth/authorize?${q.toString()}`;
}

export function tokenFromOAuthResponse(
  json: {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
  },
  nowMs = Date.now(),
): LinearTokenFile {
  if (!json.access_token) {
    throw new Error("Linear OAuth missing access_token");
  }
  const expiresIn = typeof json.expires_in === "number" ? json.expires_in : 0;
  return {
    access_token: json.access_token,
    ...(json.refresh_token ? { refresh_token: json.refresh_token } : {}),
    ...(expiresIn > 0 ? { expires_at: nowMs + expiresIn * 1000 } : {}),
  };
}

async function writeTokenFile(tokenPath: string, token: LinearTokenFile): Promise<void> {
  await writeFile(tokenPath, JSON.stringify(token), "utf8");
}

export async function readTokenFile(tokenPath: string): Promise<LinearTokenFile | null> {
  if (!existsSync(tokenPath)) return null;
  const raw = JSON.parse(await readFile(tokenPath, "utf8")) as LinearTokenFile;
  if (!raw.access_token) return null;
  return raw;
}

async function postOAuthToken(
  body: URLSearchParams,
  fetchImpl: typeof fetch,
): Promise<LinearTokenFile> {
  const res = await fetchImpl("https://api.linear.app/oauth/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Linear OAuth HTTP ${res.status}${text ? `: ${text.slice(0, 200)}` : ""}`);
  }
  return tokenFromOAuthResponse((await res.json()) as { access_token?: string; refresh_token?: string; expires_in?: number });
}

export async function exchangeOAuthCode(opts: {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  code: string;
  tokenPath: string;
  fetchImpl?: typeof fetch;
}): Promise<string> {
  const fetchFn = opts.fetchImpl ?? fetch;
  const token = await postOAuthToken(
    new URLSearchParams({
      grant_type: "authorization_code",
      client_id: opts.clientId,
      client_secret: opts.clientSecret,
      redirect_uri: opts.redirectUri,
      code: opts.code,
    }),
    fetchFn,
  );
  await writeTokenFile(opts.tokenPath, token);
  return token.access_token;
}

let refreshLock: Promise<string> | null = null;

export async function loadValidAccessToken(opts: {
  tokenPath: string;
  clientId: string;
  clientSecret: string;
  nowMs?: number;
  fetchImpl?: typeof fetch;
}): Promise<string> {
  const now = opts.nowMs ?? Date.now();
  const file = await readTokenFile(opts.tokenPath);
  if (!file) {
    throw new Error("token.json missing; complete Linear OAuth first");
  }
  const fresh = file.expires_at && now < file.expires_at - 60_000;
  if (fresh || !file.refresh_token) {
    return file.access_token;
  }
  if (!refreshLock) {
    refreshLock = (async () => {
      const next = await postOAuthToken(
        new URLSearchParams({
          grant_type: "refresh_token",
          refresh_token: file.refresh_token!,
          client_id: opts.clientId,
          client_secret: opts.clientSecret,
        }),
        opts.fetchImpl ?? fetch,
      );
      if (!next.refresh_token && file.refresh_token) {
        next.refresh_token = file.refresh_token;
      }
      await writeTokenFile(opts.tokenPath, next);
      return next.access_token;
    })().finally(() => {
      refreshLock = null;
    });
  }
  return refreshLock;
}

export async function commentOnIssue(token: string, issueId: string, body: string): Promise<void> {
  await graphql(
    token,
    `mutation CommentCreate($input: CommentCreateInput!) {
      commentCreate(input: $input) { success }
    }`,
    { input: { issueId, body } },
  );
}

const ISSUE_UPDATE = `
mutation IssueUpdate($id: String!, $input: IssueUpdateInput!) {
  issueUpdate(id: $id, input: $input) { success }
}
`;

export async function updateIssueDescription(
  token: string,
  issueId: string,
  description: string,
): Promise<void> {
  await graphql(token, ISSUE_UPDATE, { id: issueId, input: { description } });
}

export async function updateIssueTitle(token: string, issueId: string, title: string): Promise<void> {
  await graphql(token, ISSUE_UPDATE, { id: issueId, input: { title } });
}

export function matchWorkflowState(
  states: { id: string; name: string }[],
  stateName: string,
): { id: string; name: string } | undefined {
  const want = stateName.trim().toLowerCase();
  return (
    states.find((s) => s.name.toLowerCase() === want) ??
    states.find((s) => s.name.toLowerCase().replace(/\s+/g, "") === want.replace(/\s+/g, ""))
  );
}

export async function updateIssueState(
  token: string,
  issueId: string,
  stateName: string,
): Promise<void> {
  const data = (await graphql(
    token,
    `query IssueTeam($id: String!) {
      issue(id: $id) {
        identifier
        team { states { nodes { id name } } }
      }
    }`,
    { id: issueId },
  )) as {
    issue?: {
      identifier?: string;
      team?: { states?: { nodes?: { id: string; name: string }[] } };
    };
  };
  const states = data.issue?.team?.states?.nodes ?? [];
  const match = matchWorkflowState(states, stateName);
  if (!match) {
    const known = states.map((s) => s.name).join(", ");
    throw new Error(
      `Unknown state "${stateName}" for ${data.issue?.identifier ?? issueId}. Known: ${known}`,
    );
  }
  await graphql(token, ISSUE_UPDATE, { id: issueId, input: { stateId: match.id } });
}
