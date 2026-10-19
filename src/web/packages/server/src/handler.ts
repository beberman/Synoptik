import { Unsupported, type AgentController } from "@synoptik/agents";
import { bearerMatches, isLoopback } from "./auth.js";
import { isAllowed, isRead, isWrite } from "./allow.js";
import { exists, listFolders } from "./folders.js";
import type { Stores } from "./store.js";

export interface HandlerConfig {
  /** The Synoptik service, for example http://127.0.0.1:4780. Its host is sent as Host. */
  serviceUrl: string;
  /** When set, every request needs `Authorization: Bearer <token>`. */
  token?: string;
  stores: Stores;
  fetch?: typeof fetch;
  /** The agent tools to offer. Each is asked what it can do, and only that is offered. */
  adapters?: AgentController[];
  /** Status changes for `/api/events`: call the listener with a JSON-able event; returns an unsubscribe. */
  subscribe?: (listener: (event: unknown) => void) => () => void;
}

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const refuse = (status: number, name: string, message: string) => json(status, { name, message });

/**
 * A function from a request to a response, with no listener of its own
 * (DES-0057 D4). The standalone listener and the CloudCLI plugin server both
 * call it, so there is one proxy to test and one to audit.
 */
export function createHandler(config: HandlerConfig): (request: Request) => Promise<Response> {
  const doFetch = config.fetch ?? fetch;
  const service = config.serviceUrl.replace(/\/$/, "");

  async function forward(operation: string, request: Request, url: URL, body?: unknown): Promise<Response> {
    const search = isRead(operation) ? url.search : "";
    const init: RequestInit = { method: isRead(operation) ? "GET" : "POST", headers: {} };
    if (!isRead(operation)) {
      (init.headers as Record<string, string>)["content-type"] = "application/json";
      init.body = JSON.stringify(body ?? {});
    }
    // The request goes to the service's own URL, so Host is the service's
    // loopback name and DEC-0008's check passes. The caller's Authorization is
    // not forwarded: the service has no credential to check it against.
    const upstream = await doFetch(`${service}/v1/${operation}${search}`, init);
    return new Response(await upstream.text(), {
      status: upstream.status,
      headers: { "content-type": upstream.headers.get("content-type") ?? "application/json" },
    });
  }

  /** The root path of the repository named NAME, from the service's own status. */
  async function rootOf(name: string): Promise<string | null> {
    const answer = await doFetch(`${service}/v1/status?repository=${encodeURIComponent(name)}`);
    if (!answer.ok) return null;
    return ((await answer.json()) as { root?: string }).root?.replace(/\/$/, "") ?? null;
  }

  async function operate(operation: string, request: Request, url: URL): Promise<Response> {
    if (!isAllowed(operation)) {
      return refuse(403, "NOT-ALLOWED", `${operation} is not an operation this interface forwards.`);
    }
    if (isRead(operation)) return forward(operation, request, url);
    if (request.method !== "POST") return refuse(405, "METHOD-NOT-ALLOWED", `${operation} changes state and needs POST.`);
    let body: Record<string, unknown>;
    try { body = (await request.json()) as Record<string, unknown>; }
    catch { return refuse(400, "MALFORMED-REQUEST", "The request body is not JSON."); }

    // `watch` makes the service read a directory, so it only gets one the
    // server offered: a path under a configured root that is a git repository.
    if (operation === "watch") {
      const workspace = await config.stores.workspace.read();
      const offered = (await listFolders(workspace.roots)).find((f) => f.path === body.path && f.git);
      const remembered = workspace.repositories.some((r) => r.path === body.path);
      if (!offered && !remembered) {
        return refuse(403, "FOLDER-NOT-OFFERED", "That folder is not under a configured root, or is not a git repository.");
      }
    }
    let path: string | null = null;
    if (operation === "pause" || operation === "unwatch") {
      path = await rootOf(String(body.repository ?? ""));
    }

    const response = await forward(operation, request, url, body);
    if (!response.ok) return response;

    // The service accepted it, so the file may change (D16). A failed write of
    // the file is reported and the service keeps what it was told.
    try {
      if (operation === "watch") {
        await config.stores.updateWorkspace((w) => {
          const entry = w.repositories.find((r) => r.path === body.path);
          if (entry) entry.paused = false; else w.repositories.push({ path: String(body.path), paused: false });
        });
      } else if (operation === "pause" && path) {
        await config.stores.updateWorkspace((w) => {
          const entry = w.repositories.find((r) => r.path === path);
          if (entry) entry.paused = true;
        });
      } else if (operation === "unwatch" && path) {
        await config.stores.updateWorkspace((w) => { w.repositories = w.repositories.filter((r) => r.path !== path); });
      }
    } catch (error: any) {
      const answer = JSON.parse(await response.clone().text() || "{}");
      return json(response.status, { ...answer, warning: `The workspace file was not updated: ${error.message}` });
    }
    return response;
  }

  async function workspace(): Promise<Response> {
    const file = await config.stores.workspace.read();
    const repositories = await Promise.all(file.repositories.map(async (r) => ({ ...r, missing: !(await exists(r.path)) })));
    return json(200, { roots: file.roots, repositories, damaged: config.stores.workspace.damage });
  }

  /** Take a folder out of the workspace file without asking the service: for one that is gone from disk. */
  async function forget(request: Request): Promise<Response> {
    if (request.method !== "POST") return refuse(405, "METHOD-NOT-ALLOWED", "Use POST.");
    const { path } = (await request.json().catch(() => ({}))) as { path?: string };
    const file = await config.stores.workspace.read();
    if (!file.repositories.some((r) => r.path === path)) return refuse(404, "NOT-IN-WORKSPACE", "That folder is not in the workspace file.");
    try {
      await config.stores.updateWorkspace((w) => { w.repositories = w.repositories.filter((r) => r.path !== path); });
    } catch (error: any) { return refuse(409, "STATE-FILE-DAMAGED", error.message); }
    return json(200, { forgotten: path });
  }

  async function folders(): Promise<Response> {
    const file = await config.stores.workspace.read();
    const watched = new Set(file.repositories.map((r) => r.path));
    const list = await listFolders(file.roots);
    return json(200, {
      roots: file.roots,
      folders: list.map((f) => ({ ...f, watched: watched.has(f.path) })),
      damaged: config.stores.workspace.damage,
    });
  }

  async function uiState(request: Request): Promise<Response> {
    if (request.method === "GET") {
      const value = await config.stores.ui.read();
      return json(200, { ...value, damaged: config.stores.ui.damage });
    }
    if (request.method !== "PUT") return refuse(405, "METHOD-NOT-ALLOWED", "Use GET or PUT.");
    let body: Record<string, unknown>;
    try { body = (await request.json()) as Record<string, unknown>; }
    catch { return refuse(400, "MALFORMED-REQUEST", "The request body is not JSON."); }
    try {
      await config.stores.ui.write({ ...body, version: 1 });
    } catch (error: any) {
      return refuse(409, "STATE-FILE-DAMAGED", error.message);
    }
    return json(200, { saved: true });
  }

  // What a launch did, newest first. A launch to a tool that answers when the run
  // ends would hold a request open for hours, so the route replies at once and
  // the outcome is recorded here for the panel to show.
  type Launch = { adapter: string; repository: string; task: string; state: "running" | "finished" | "failed"; error?: string; at: string };
  const launches: Launch[] = [];

  async function agents(request: Request, route: string): Promise<Response> {
    const adapters = config.adapters ?? [];
    const [, id, action] = route.split("/");
    if (!id) {
      return json(200, {
        adapters: await Promise.all(adapters.map(async (a) => ({ id: a.id, name: a.name, capabilities: await a.capabilities() }))),
        launches,
      });
    }
    const adapter = adapters.find((a) => a.id === id);
    if (!adapter) return refuse(404, "NO-SUCH-ADAPTER", `No agent adapter named ${id}.`);
    try {
      if (action === "sessions") return json(200, { sessions: await adapter.list() });
      if (action === "terminals") return await terminals(adapter, request, route);
      if (request.method !== "POST") return refuse(405, "METHOD-NOT-ALLOWED", "Use POST.");
      const body = (await request.json().catch(() => ({}))) as Record<string, string>;
      const capabilities = await adapter.capabilities();
      if (action === "launch") {
        if (!capabilities.supported.includes("launch")) throw new Unsupported(adapter.name, "launch", capabilities.notes.launch);
        if (!body.repository || !body.task) return refuse(400, "MALFORMED-REQUEST", "A launch needs a repository and a task.");
        const record: Launch = { adapter: adapter.id, repository: body.repository, task: body.task, state: "running", at: new Date().toISOString() };
        launches.unshift(record);
        launches.length = Math.min(launches.length, 20);
        adapter.launch({ repository: body.repository, task: body.task, provider: body.provider })
          .then(() => { record.state = "finished"; })
          .catch((e: Error) => { record.state = "failed"; record.error = e.message; });
        return json(202, { accepted: true });
      }
      if (action === "stop") {
        if (!capabilities.supported.includes("stop")) throw new Unsupported(adapter.name, "stop", capabilities.notes.stop);
        await adapter.stop(String(body.session ?? ""));
        return json(200, { stopped: true });
      }
      return refuse(404, "NOT-FOUND", `No agent route ${route}.`);
    } catch (error: any) {
      if (error instanceof Unsupported) return refuse(501, "UNSUPPORTED", error.message);
      return refuse(502, "ADAPTER-FAILED", String(error?.message ?? error));
    }
  }

  // A terminal is opened, listed and closed here; its bytes go through the
  // WebSocket proxy in terminals.ts (DES-0057 D21).
  async function terminals(adapter: AgentController, request: Request, route: string): Promise<Response> {
    const [, , , name, sub] = route.split("/");
    const capabilities = await adapter.capabilities();
    if (!capabilities.supported.includes("terminal")) throw new Unsupported(adapter.name, "terminal", capabilities.notes.terminal);
    if (!name && request.method === "GET") return json(200, { terminals: await adapter.terminals() });
    if (request.method !== "POST") return refuse(405, "METHOD-NOT-ALLOWED", "Use POST.");
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    if (!name) {
      if (typeof body.repository !== "string") return refuse(400, "MALFORMED-REQUEST", "A terminal needs a repository.");
      const num = (v: unknown) => (typeof v === "number" ? v : undefined);
      return json(200, await adapter.openTerminal({
        repository: body.repository, message: typeof body.message === "string" ? body.message : undefined, cols: num(body.cols), rows: num(body.rows),
      }));
    }
    if (sub === "close") { await adapter.closeTerminal(decodeURIComponent(name)); return json(200, { closed: true }); }
    return refuse(404, "NOT-FOUND", `No agent route ${route}.`);
  }

  function events(): Response {
    let unsubscribe = () => {};
    let timer: ReturnType<typeof setInterval>;
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode(": connected\n\n"));
        timer = setInterval(() => controller.enqueue(encoder.encode(": keepalive\n\n")), 15000);
        unsubscribe = config.subscribe?.((event) =>
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`))) ?? (() => {});
      },
      cancel() { clearInterval(timer); unsubscribe(); },
    });
    return new Response(stream, { headers: { "content-type": "text/event-stream", "cache-control": "no-cache" } });
  }

  return async function handle(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (!url.pathname.startsWith("/api/")) return refuse(404, "NOT-FOUND", "Not an /api/ path.");

    // Authentication. With a token every request needs it. Without one the
    // server is loopback-only, so the same two checks DEC-0008 makes on the
    // service apply here: the Host must be loopback and a browser's Origin
    // must be this server, or any web page could write through the user's
    // own browser.
    if (config.token) {
      if (!bearerMatches(request.headers.get("authorization"), config.token)) {
        return refuse(401, "UNAUTHORIZED", "A bearer token is required.");
      }
    } else {
      const host = (request.headers.get("host") ?? url.host).replace(/:\d+$/, "").replace(/^\[|\]$/g, "");
      if (!isLoopback(host)) return refuse(403, "HOST-NOT-ALLOWED", "This server answers only on a loopback name when it has no token.");
      const origin = request.headers.get("origin");
      if (origin && new URL(origin).host !== (request.headers.get("host") ?? url.host)) {
        return refuse(403, "ORIGIN-NOT-ALLOWED", "Cross-origin requests are refused.");
      }
    }

    try {
      const route = url.pathname.slice("/api/".length);
      if (route.startsWith("v1/")) return await operate(route.slice(3), request, url);
      if (route === "folders") return await folders();
      if (route === "workspace") return await workspace();
      if (route === "workspace/forget") return await forget(request);
      if (route === "ui-state") return await uiState(request);
      if (route === "events") return events();
      if (route === "agents" || route.startsWith("agents/")) return await agents(request, route);
      return refuse(404, "NOT-FOUND", `No route /api/${route}.`);
    } catch (error: any) {
      const unreachable = error?.cause?.code === "ECONNREFUSED" || error?.name === "TypeError";
      return refuse(unreachable ? 502 : 500, unreachable ? "SERVICE-UNREACHABLE" : "INTERNAL", String(error?.message ?? error));
    }
  };
}

export interface RestoreEntry { path: string; paused: boolean; state: "watched" | "missing" | "failed"; message?: string }

/**
 * Replay the workspace file against the service at startup: `watch` for each
 * folder and `pause` for each paused one. A folder that is gone is reported as
 * missing and stays in the file.
 */
export async function restoreWorkspace(config: Pick<HandlerConfig, "serviceUrl" | "stores" | "fetch">): Promise<RestoreEntry[]> {
  const doFetch = config.fetch ?? fetch;
  const service = config.serviceUrl.replace(/\/$/, "");
  const file = await config.stores.workspace.read();
  const report: RestoreEntry[] = [];
  for (const entry of file.repositories) {
    if (!(await exists(entry.path))) { report.push({ ...entry, state: "missing" }); continue; }
    try {
      const watched = await doFetch(`${service}/v1/watch`, {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ path: entry.path }),
      });
      if (!watched.ok) { report.push({ ...entry, state: "failed", message: await watched.text() }); continue; }
      if (entry.paused) {
        const name = ((await watched.json()) as { name: string }).name;
        await doFetch(`${service}/v1/pause`, {
          method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ repository: name }),
        });
      }
      report.push({ ...entry, state: "watched" });
    } catch (error: any) {
      report.push({ ...entry, state: "failed", message: String(error?.message ?? error) });
    }
  }
  return report;
}
