// What the agent host answers (DES-0057 D20). The vocabulary of `Status` is the
// adapter interface's in @synoptik/agents; it is written again here because the
// host runs on the machine with the files and depends on nothing else in src/web.

export type Status = "working" | "idle" | "finished" | "failed";

export interface Session {
  id: string;
  task: string;
  /** The repository's real path on this machine. */
  repository: string;
  status: Status;
  /** ISO time of the last change of status. */
  since: string;
  /** Why a run failed, in the tool's words. */
  error?: string;
}

export type HostEvent =
  | { type: "status"; status: Status; since: string }
  | { type: "output"; text: string }
  | { type: "end"; status: Status; error?: string };

/** How a run ended. `stopped` is a person's stop, which is not a failure. */
export interface Outcome { ok: boolean; stopped: boolean; message?: string }

export interface RunHooks {
  /** A line of what the agent said or did, short enough to show. */
  output(text: string): void;
}

export interface RunningAgent {
  stop(): void;
  finished: Promise<Outcome>;
}

/** Starts one agent run in a directory. The host knows nothing else about the tool. */
export interface Runner {
  start(request: { cwd: string; task: string }, hooks: RunHooks): RunningAgent;
}
