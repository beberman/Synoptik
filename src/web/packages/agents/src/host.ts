import { BaseAdapter, type Capabilities, type LaunchRequest, type OpenTerminal, type Session, type Status, type Terminal, type TerminalSocket } from "./types.js";

export interface HostConfig {
  /** The agent host, for example http://127.0.0.1:4795. */
  baseUrl: string;
  /** The bearer token the host requires. */
  token: string;
  fetch?: typeof fetch;
}

interface HostSession { id: string; task: string; repository: string; status: Status; since: string; error?: string }

/**
 * The agent host of DES-0057 D20, which runs next to the files and starts the
 * agent there. This adapter is the only code in the web server that knows it:
 * it forwards the interface's methods as the host's routes with the token, and
 * holds no credential for the model.
 */
export class HostAdapter extends BaseAdapter {
  readonly id = "host";
  readonly name = "Agent host";
  constructor(private readonly config: HostConfig) { super(); }

  private get base() { return `${this.config.baseUrl.replace(/\/$/, "")}/host/v1`; }
  private get doFetch() { return this.config.fetch ?? fetch; }
  private headers(extra: Record<string, string> = {}) { return { authorization: `Bearer ${this.config.token}`, ...extra }; }

  private async call<T>(method: "GET" | "POST", path: string, body?: unknown): Promise<T> {
    const response = await this.doFetch(`${this.base}${path}`, {
      method, headers: this.headers(body === undefined ? {} : { "content-type": "application/json" }),
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await response.text();
    let parsed: any = null;
    try { parsed = text ? JSON.parse(text) : null; } catch { parsed = { message: text }; }
    if (!response.ok) throw new Error(parsed?.message ?? `The agent host answered ${response.status}.`);
    return parsed as T;
  }

  async capabilities(): Promise<Capabilities> {
    try {
      return await this.call<Capabilities>("GET", "/capabilities");
    } catch (error: any) {
      // A host that is down offers nothing, and says why where the panel can show it.
      return { supported: [], notes: { launch: `The agent host did not answer: ${error.message}` } };
    }
  }

  private toSession(s: HostSession): Session {
    return { id: s.id, task: s.task, repository: s.repository, status: s.status, since: s.since };
  }

  async list(): Promise<Session[]> {
    return (await this.call<{ sessions: HostSession[] }>("GET", "/sessions")).sessions.map((s) => this.toSession(s));
  }

  async launch(request: LaunchRequest): Promise<Session> {
    const { session } = await this.call<{ session: HostSession }>("POST", "/sessions", { repository: request.repository, task: request.task });
    return this.toSession(session);
  }

  async stop(id: string): Promise<void> { await this.call("POST", `/sessions/${encodeURIComponent(id)}/stop`, {}); }

  async status(id: string): Promise<Status> {
    return (await this.call<{ session: HostSession }>("GET", `/sessions/${encodeURIComponent(id)}`)).session.status;
  }

  async terminals(): Promise<Terminal[]> {
    return (await this.call<{ terminals: Terminal[] }>("GET", "/terminals")).terminals;
  }

  async openTerminal(request: OpenTerminal): Promise<{ terminal: Terminal; started: boolean }> {
    return this.call("POST", "/terminals", request);
  }

  async closeTerminal(name: string): Promise<void> { await this.call("POST", `/terminals/${encodeURIComponent(name)}/close`, {}); }

  terminalSocket(name: string, cols: number, rows: number): TerminalSocket {
    const url = new URL(`${this.base}/terminals/${encodeURIComponent(name)}/io`);
    url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
    url.searchParams.set("cols", String(cols));
    url.searchParams.set("rows", String(rows));
    return { url: url.toString(), headers: this.headers() };
  }

  subscribe(id: string, on: (status: Status) => void): () => void {
    const abort = new AbortController();
    void (async () => {
      try {
        const response = await this.doFetch(`${this.base}/sessions/${encodeURIComponent(id)}/events`, { headers: this.headers(), signal: abort.signal });
        if (!response.ok || !response.body) return;
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        for (;;) {
          const { done, value } = await reader.read();
          if (done) return;
          buffer += decoder.decode(value, { stream: true });
          for (let end = buffer.indexOf("\n\n"); end >= 0; end = buffer.indexOf("\n\n")) {
            const block = buffer.slice(0, end);
            buffer = buffer.slice(end + 2);
            for (const line of block.split("\n")) {
              if (!line.startsWith("data: ")) continue;
              try { const e = JSON.parse(line.slice(6)); if (e.type === "status" || e.type === "end") on(e.status as Status); } catch { /* not an event */ }
            }
          }
        }
      } catch { /* closed or unreachable: the caller asks again if it wants */ }
    })();
    return () => abort.abort();
  }
}
