import Database from "better-sqlite3";

export type IssueStatus = "running" | "queued" | "awaiting_input" | "complete" | "error";

export type IssueRecord = {
  issueId: string;
  issueIdentifier: string;
  linearAgentSessionId: string;
  grokSessionId: string | null;
  worktreePath: string | null;
  branch: string | null;
  status: IssueStatus;
  queuedPrompt: string;
  pid: number | null;
  updatedAt: number;
};

type IssueRow = {
  issue_id: string;
  issue_identifier: string;
  linear_agent_session_id: string;
  grok_session_id: string | null;
  worktree_path: string | null;
  branch: string | null;
  status: IssueStatus;
  queued_prompt: string;
  pid: number | null;
  updated_at: number;
};

function toRecord(row: IssueRow): IssueRecord {
  return {
    issueId: row.issue_id,
    issueIdentifier: row.issue_identifier,
    linearAgentSessionId: row.linear_agent_session_id,
    grokSessionId: row.grok_session_id,
    worktreePath: row.worktree_path,
    branch: row.branch,
    status: row.status,
    queuedPrompt: row.queued_prompt,
    pid: row.pid,
    updatedAt: row.updated_at,
  };
}

export type Store = {
  getByIssueId(issueId: string): IssueRecord | null;
  upsert(record: IssueRecord): void;
  appendQueuedPrompt(issueId: string, text: string): void;
  takeQueuedPrompt(issueId: string): string;
  markEventProcessed(eventId: string): boolean;
  listRunning(): IssueRecord[];
  listByStatus(status: IssueStatus): IssueRecord[];
};

export function openStore(dbPath: string): Store {
  const db = new Database(dbPath);
  db.exec(`
    CREATE TABLE IF NOT EXISTS issue (
      issue_id TEXT PRIMARY KEY,
      issue_identifier TEXT NOT NULL,
      linear_agent_session_id TEXT NOT NULL,
      grok_session_id TEXT,
      worktree_path TEXT,
      branch TEXT,
      status TEXT NOT NULL,
      queued_prompt TEXT NOT NULL DEFAULT '',
      pid INTEGER,
      updated_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS processed_event (
      event_id TEXT PRIMARY KEY
    );
  `);

  const getStmt = db.prepare("SELECT * FROM issue WHERE issue_id = ?");
  const upsertStmt = db.prepare(`
    INSERT INTO issue (
      issue_id, issue_identifier, linear_agent_session_id, grok_session_id,
      worktree_path, branch, status, queued_prompt, pid, updated_at
    ) VALUES (
      @issueId, @issueIdentifier, @linearAgentSessionId, @grokSessionId,
      @worktreePath, @branch, @status, @queuedPrompt, @pid, @updatedAt
    )
    ON CONFLICT(issue_id) DO UPDATE SET
      issue_identifier = excluded.issue_identifier,
      linear_agent_session_id = excluded.linear_agent_session_id,
      grok_session_id = excluded.grok_session_id,
      worktree_path = excluded.worktree_path,
      branch = excluded.branch,
      status = excluded.status,
      queued_prompt = excluded.queued_prompt,
      pid = excluded.pid,
      updated_at = excluded.updated_at
  `);
  const appendStmt = db.prepare(`
    UPDATE issue
    SET queued_prompt = CASE
      WHEN queued_prompt = '' THEN ?
      ELSE queued_prompt || char(10) || ?
    END,
    updated_at = ?
    WHERE issue_id = ?
  `);
  const takeStmt = db.prepare("SELECT queued_prompt FROM issue WHERE issue_id = ?");
  const clearStmt = db.prepare(
    "UPDATE issue SET queued_prompt = '', updated_at = ? WHERE issue_id = ?",
  );
  const insertEvent = db.prepare("INSERT INTO processed_event (event_id) VALUES (?)");
  const listRunningStmt = db.prepare("SELECT * FROM issue WHERE status = 'running'");
  const listByStatusStmt = db.prepare("SELECT * FROM issue WHERE status = ?");

  return {
    getByIssueId(issueId) {
      const row = getStmt.get(issueId) as IssueRow | undefined;
      return row ? toRecord(row) : null;
    },
    upsert(record) {
      upsertStmt.run(record);
    },
    appendQueuedPrompt(issueId, text) {
      appendStmt.run(text, text, Date.now(), issueId);
    },
    takeQueuedPrompt(issueId) {
      const row = takeStmt.get(issueId) as { queued_prompt: string } | undefined;
      const value = row?.queued_prompt ?? "";
      clearStmt.run(Date.now(), issueId);
      return value;
    },
    markEventProcessed(eventId) {
      try {
        insertEvent.run(eventId);
        return true;
      } catch (err) {
        const code = (err as { code?: string }).code;
        if (code === "SQLITE_CONSTRAINT_PRIMARYKEY" || code === "SQLITE_CONSTRAINT_UNIQUE") {
          return false;
        }
        throw err;
      }
    },
    listRunning() {
      return (listRunningStmt.all() as IssueRow[]).map(toRecord);
    },
    listByStatus(status) {
      return (listByStatusStmt.all(status) as IssueRow[]).map(toRecord);
    },
  };
}
