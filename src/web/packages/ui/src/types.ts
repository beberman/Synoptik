export type Doc = {
  repo: string;
  id: string;
  type: string;
  title: string;
  status: string;
  priority: string;
  date: string;
  tags: string[];
  refines: string[];
  affects: string[];
  severity: string;
  path: string;
};

export type Repo = {
  name: string;
  path: string;
  commit: string;
  documents: number;
  state: "ready" | "indexing" | "paused";
  /** The folder is in the workspace file and no longer on disk. */
  missing?: boolean;
};

export type Filters = {
  repos: string[];
  types: string[];
  statuses: string[];
  priority: string;
  tag: string;
  text: string;
  widen: number;
};

export type AgentStatus =
  | "working"
  | "waiting-input"
  | "waiting-approval"
  | "idle"
  | "finished"
  | "failed"
  | "unknown";

export type Session = {
  id: string;
  task: string;
  repository: string;
  status: AgentStatus;
  since: string;
};

export type AdapterMode = "full" | "list-only" | "none";
