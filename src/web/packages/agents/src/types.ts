// The interface for launching and watching agents (REQ-0080 R8-R10, DES-0057 D8).
// An adapter implements the methods its tool offers and says which in
// `capabilities()`. The interface renders a control only for a capability that
// was reported, and a method an adapter lacks rejects with Unsupported.

export type Status = "working" | "waiting-input" | "waiting-approval" | "idle" | "finished" | "failed" | "unknown";

export interface Session {
  id: string;
  /** What the session is about, as the tool names it. */
  task: string;
  /** The folder or project the tool ran it in. */
  repository: string;
  status: Status;
  /** ISO time of the last activity the tool reported. */
  since: string;
  provider?: string;
}

export type Capability = "list" | "launch" | "stop" | "status" | "subscribe" | "approve";

export interface Capabilities {
  /** The methods this adapter implements. */
  supported: Capability[];
  /** Why a method is missing, for a person reading the panel. */
  notes: Partial<Record<Capability, string>>;
}

export interface LaunchRequest { repository: string; task: string; provider?: string }

export interface AgentController {
  readonly id: string;
  readonly name: string;
  capabilities(): Promise<Capabilities>;
  list(): Promise<Session[]>;
  launch(request: LaunchRequest): Promise<Session>;
  stop(id: string): Promise<void>;
  status(id: string): Promise<Status>;
  subscribe(id: string, on: (status: Status) => void): () => void;
  approve(id: string, requestId: string, allow: boolean): Promise<void>;
}

export class Unsupported extends Error {
  constructor(readonly adapter: string, readonly capability: Capability, reason?: string) {
    super(reason ?? `${adapter} does not support ${capability}.`);
    this.name = "Unsupported";
  }
}

/** Methods an adapter did not write all reject the same way. */
export abstract class BaseAdapter implements AgentController {
  abstract readonly id: string;
  abstract readonly name: string;
  abstract capabilities(): Promise<Capabilities>;
  list(): Promise<Session[]> { return Promise.reject(new Unsupported(this.name, "list")); }
  launch(_request: LaunchRequest): Promise<Session> { return Promise.reject(new Unsupported(this.name, "launch")); }
  stop(_id: string): Promise<void> { return Promise.reject(new Unsupported(this.name, "stop")); }
  status(_id: string): Promise<Status> { return Promise.reject(new Unsupported(this.name, "status")); }
  subscribe(_id: string, _on: (status: Status) => void): () => void { throw new Unsupported(this.name, "subscribe"); }
  approve(_id: string, _requestId: string, _allow: boolean): Promise<void> { return Promise.reject(new Unsupported(this.name, "approve")); }
}

