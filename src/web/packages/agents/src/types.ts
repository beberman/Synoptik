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

export type Capability = "list" | "launch" | "stop" | "status" | "subscribe" | "approve" | "terminal";

export interface Capabilities {
  /** The methods this adapter implements. */
  supported: Capability[];
  /** Why a method is missing, for a person reading the panel. */
  notes: Partial<Record<Capability, string>>;
  /** Whether the tool is signed in, when the adapter can tell. */
  login?: { loggedIn: boolean; authMethod?: string } | null;
}

/** An interactive terminal with an agent in it (REQ-0080 R23, DES-0057 D21). */
export interface Terminal {
  /** The terminal's id. */
  name: string;
  repository: string;
  since: string;
  /** Clients attached now, the page's among them. */
  attached: number;
}

export interface OpenTerminal { repository: string; message?: string; cols?: number; rows?: number }

/** Where the server's proxy connects for a terminal's bytes. */
export interface TerminalSocket { url: string; headers: Record<string, string> }

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
  terminals(): Promise<Terminal[]>;
  /** The repository's terminal, started if there is none. `started` says which. */
  openTerminal(request: OpenTerminal): Promise<{ terminal: Terminal; started: boolean }>;
  closeTerminal(name: string): Promise<void>;
  terminalSocket(name: string, cols: number, rows: number): TerminalSocket;
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
  terminals(): Promise<Terminal[]> { return Promise.reject(new Unsupported(this.name, "terminal")); }
  openTerminal(_request: OpenTerminal): Promise<{ terminal: Terminal; started: boolean }> { return Promise.reject(new Unsupported(this.name, "terminal")); }
  closeTerminal(_name: string): Promise<void> { return Promise.reject(new Unsupported(this.name, "terminal")); }
  terminalSocket(_name: string, _cols: number, _rows: number): TerminalSocket { throw new Unsupported(this.name, "terminal"); }
}

