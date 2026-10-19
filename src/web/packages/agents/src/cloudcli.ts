import { BaseAdapter, Unsupported, type Capabilities, type LaunchRequest, type Session, type Status } from "./types.js";

export interface CloudCliConfig {
  /** CloudCLI's address, for example http://127.0.0.1:3001. */
  baseUrl: string;
  /** A JWT for the browser-facing routes (`/api/projects`). Lists sessions. */
  token?: string;
  /** An API key made in CloudCLI's settings, for `POST /api/agent`. Starts a run. */
  apiKey?: string;
  fetch?: typeof fetch;
}

interface CloudProject { name?: string; displayName?: string; path?: string; fullPath?: string; sessions?: CloudSession[] }
interface CloudSession { id: string; provider?: string; summary?: string; lastActivity?: string; messageCount?: number }

/**
 * CloudCLI (siteboon/claudecodeui), read from its source on 2026-10-17.
 *
 *   list    GET /api/projects, Authorization: Bearer <jwt>. Each project carries
 *           its sessions: id, provider, summary, lastActivity, messageCount.
 *   launch  POST /api/agent, x-api-key. Body {projectPath, message, provider,
 *           stream}. With stream false the response arrives when the run ends.
 *
 * Not offered: stop, status, subscribe and approve. The REST routes read have no
 * abort and no running-state route; a run's state travels on CloudCLI's
 * WebSocket, whose messages are not documented, so a status here would be a
 * guess. A session's state is therefore `unknown` rather than inferred from its
 * last activity. Not yet run against a live CloudCLI.
 */
export class CloudCliAdapter extends BaseAdapter {
  readonly id = "cloudcli";
  readonly name = "CloudCLI";
  constructor(private readonly config: CloudCliConfig) { super(); }

  private get doFetch() { return this.config.fetch ?? fetch; }
  private get base() { return this.config.baseUrl.replace(/\/$/, ""); }

  async capabilities(): Promise<Capabilities> {
    const supported: Capabilities["supported"] = [];
    const notes: Capabilities["notes"] = {
      stop: "CloudCLI's REST routes have no abort; a run is stopped from its own session view.",
      status: "A run's state is only on CloudCLI's WebSocket, which is not read here.",
      subscribe: "A run's state is only on CloudCLI's WebSocket, which is not read here.",
      approve: "Approvals are answered in CloudCLI's own session view.",
    };
    if (this.config.token) supported.push("list"); else notes.list = "No CloudCLI token is configured (SYNOPTIK_CLOUDCLI_TOKEN).";
    if (this.config.apiKey) supported.push("launch"); else notes.launch = "No CloudCLI API key is configured (SYNOPTIK_CLOUDCLI_API_KEY).";
    return { supported, notes };
  }

  async list(): Promise<Session[]> {
    if (!this.config.token) throw new Unsupported(this.name, "list", "No CloudCLI token is configured.");
    const response = await this.doFetch(`${this.base}/api/projects`, { headers: { authorization: `Bearer ${this.config.token}` } });
    if (!response.ok) throw new Error(`CloudCLI answered ${response.status} for /api/projects.`);
    const projects = (await response.json()) as CloudProject[];
    return projects.flatMap((project) =>
      (project.sessions ?? []).map((s) => ({
        id: s.id,
        task: s.summary ?? "",
        repository: project.fullPath ?? project.path ?? project.displayName ?? project.name ?? "",
        status: "unknown" as Status,
        since: s.lastActivity ?? "",
        provider: s.provider,
      })),
    );
  }

  async launch(request: LaunchRequest): Promise<Session> {
    if (!this.config.apiKey) throw new Unsupported(this.name, "launch", "No CloudCLI API key is configured.");
    const response = await this.doFetch(`${this.base}/api/agent`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": this.config.apiKey },
      body: JSON.stringify({ projectPath: request.repository, message: request.task, provider: request.provider ?? "claude", stream: false }),
    });
    const body = (await response.json().catch(() => ({}))) as { sessionId?: string; error?: string };
    if (!response.ok) throw new Error(body.error ?? `CloudCLI answered ${response.status} for /api/agent.`);
    return { id: body.sessionId ?? "", task: request.task, repository: request.repository, status: "finished", since: new Date().toISOString(), provider: request.provider ?? "claude" };
  }
}
