import { join } from "node:path";

export type GitRunner = (args: string[], cwd?: string) => { stdout: string; status: number };

export function branchName(issueIdentifier: string): string {
  return `feat/${issueIdentifier.toLowerCase()}`;
}

export function worktreeDir(agentRoot: string, issueIdentifier: string): string {
  return join(agentRoot, "worktrees", issueIdentifier);
}

export function ensureWorktree(opts: {
  repoPath: string;
  agentRoot: string;
  issueIdentifier: string;
  existingPath: string | null;
  git: GitRunner;
  exists: (path: string) => boolean;
}): { worktreePath: string; branch: string; created: boolean } {
  const branch = branchName(opts.issueIdentifier);
  if (opts.existingPath && opts.exists(opts.existingPath)) {
    return { worktreePath: opts.existingPath, branch, created: false };
  }
  const worktreePath = worktreeDir(opts.agentRoot, opts.issueIdentifier);
  const result = opts.git([
    "-C",
    opts.repoPath,
    "worktree",
    "add",
    "-b",
    branch,
    worktreePath,
  ]);
  if (result.status !== 0) {
    opts.git(["-C", opts.repoPath, "worktree", "add", worktreePath, branch]);
  }
  return { worktreePath, branch, created: true };
}

export function acquireWorktreeLock(
  worktreePath: string,
  openWx: (lockPath: string) => { close(): void },
): () => void {
  const handle = openWx(join(worktreePath, ".grok-agent.lock"));
  return () => {
    handle.close();
  };
}
