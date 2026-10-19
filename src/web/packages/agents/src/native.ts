import { BaseAdapter, type Capabilities } from "./types.js";

/**
 * The adapter for what Synoptik itself can see of an agent. The retrieval log
 * (REQ-0036) records a task, the seeds and what came back for each `context`
 * call, and nothing in a record names the session that made it, so no session
 * can be listed and no status can be told from it. This adapter therefore
 * reports no capability and says why, and invents nothing (DES-0057 D9).
 */
export class NativeAdapter extends BaseAdapter {
  readonly id = "native";
  readonly name = "Synoptik";
  async capabilities(): Promise<Capabilities> {
    const why = "Synoptik's retrieval log records what was asked, not which session asked it, so it cannot list sessions or tell their state.";
    return {
      supported: [],
      notes: { list: why, status: why, launch: "Synoptik does not start agents.", stop: "Synoptik does not start agents.", subscribe: why, approve: "Synoptik does not start agents." },
    };
  }
}
