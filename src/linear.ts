import { writeFile } from "node:fs/promises";
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
    throw new Error(`Linear GraphQL HTTP ${res.status}`);
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
