import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  commentOnIssue,
  fetchIssueSnapshot,
  updateIssueDescription,
  updateIssueState,
  updateIssueTitle,
} from "./linear.ts";

function usage(): never {
  console.error(`Usage:
  linear-as-grok get
  linear-as-grok comment <markdown|->
  linear-as-grok description <markdown|->
  linear-as-grok title <text>
  linear-as-grok state <stateName>
Env: LINEAR_GROK_TOKEN LINEAR_ISSUE_ID
Body may be argv, "-" for stdin, or stdin when argv body is empty.`);
  process.exit(2);
}

function readStdin(): string {
  try {
    if (process.stdin.isTTY) return "";
    return readFileSync(0, "utf8");
  } catch {
    return "";
  }
}

export function resolveBody(rest: string[], stdinText: string): string {
  if (rest.length === 1 && rest[0] === "-") return stdinText;
  if (rest.length > 0) return rest.join(" ");
  return stdinText;
}

async function main(): Promise<void> {
  const token = process.env.LINEAR_GROK_TOKEN;
  const issueId = process.env.LINEAR_ISSUE_ID;
  if (!token || !issueId) {
    throw new Error("LINEAR_GROK_TOKEN and LINEAR_ISSUE_ID are required");
  }
  const [cmd, ...rest] = process.argv.slice(2);
  if (!cmd) usage();
  const body = resolveBody(rest, readStdin()).trim();
  if (cmd === "get") {
    const snap = await fetchIssueSnapshot(token, issueId);
    console.log(JSON.stringify(snap, null, 2));
    return;
  }
  if (cmd === "comment") {
    if (!body) usage();
    await commentOnIssue(token, issueId, body);
    console.log("comment ok");
    return;
  }
  if (cmd === "description") {
    if (!body) usage();
    await updateIssueDescription(token, issueId, body);
    console.log("description ok");
    return;
  }
  if (cmd === "title") {
    if (!body) usage();
    await updateIssueTitle(token, issueId, body);
    console.log("title ok");
    return;
  }
  if (cmd === "state") {
    if (!body) usage();
    await updateIssueState(token, issueId, body);
    console.log("state ok");
    return;
  }
  usage();
}

const invokedDirectly = (() => {
  try {
    const self = fileURLToPath(import.meta.url);
    const arg = process.argv[1] ?? "";
    if (arg.includes(".test.")) return false;
    return self === arg || /linearAsGrok\.ts$/.test(arg) || /linear-as-grok$/.test(arg);
  } catch {
    return false;
  }
})();

if (invokedDirectly) {
  void main().catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
