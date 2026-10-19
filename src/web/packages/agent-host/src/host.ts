import { randomUUID, timingSafeEqual } from "node:crypto";
import { realpathSync } from "node:fs";
import type { IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";
import { WebSocketServer } from "ws";
import { terminalName, type Multiplexer, type TerminalInfo } from "./terminal.js";
import type { HostEvent, Login, Runner, RunningAgent, Session } from "./types.js";

export interface HostConfig {
  /** Required on every request. */
  token: string;
  /** The repositories agents may run in, as real paths. */
  repositories: string[];
  runner: Runner;
  /** How many finished sessions are kept for listing. */
  keep?: number;
  /** Interactive terminals (DES-0057 D21). Without it the host offers none. */
  terminals?: {
    mux: Multiplexer;
    /** The program the terminal runs, before the first message. */
    command?: string[];
  };
  /** Whether the tool is signed in, as the tool reports it. */
  login?: () => Promise<Login | null>;
}

/** The handler, and the WebSocket upgrade a listener hands it for a terminal. */
export type HostHandler = ((request: Request) => Promise<Response>) & {
  upgrade?: (message: IncomingMessage, socket: Duplex, head: Buffer) => void;
};

interface Held {
  session: Session;
  running: RunningAgent | null;
  events: HostEvent[];
  listeners: Set<(e: HostEvent) => void>;
}

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });
const refuse = (status: number, name: string, message: string) => json(status, { name, message });

function tokenMatches(header: string | null, token: string): boolean {
  const given = Buffer.from((header ?? "").replace(/^Bearer\s+/i, ""));
  const wanted = Buffer.from(token);
  return given.length === wanted.length && timingSafeEqual(given, wanted);
}

/** The host as a function from a request to a response, like the web server's handler. */
export function createHostHandler(config: HostConfig): HostHandler {
  const held = new Map<string, Held>();
  const allowed = new Set(config.repositories.map((r) => realpathSync(r)));
  const keep = config.keep ?? 50;

  const publish = (h: Held, event: HostEvent) => {
    h.events.push(event);
    if (h.events.length > 300) h.events.splice(0, h.events.length - 300);
    for (const l of [...h.listeners]) l(event);
  };
  const setStatus = (h: Held, status: Session["status"], error?: string) => {
    h.session.status = status;
    h.session.since = new Date().toISOString();
    if (error) h.session.error = error;
    publish(h, { type: "status", status, since: h.session.since });
  };

  const trim = () => {
    const done = [...held.values()].filter((h) => h.session.status !== "working");
    for (const h of done.slice(0, Math.max(0, held.size - keep))) held.delete(h.session.id);
  };

  const terminalNames = new Map([...allowed].map((r) => [terminalName(r), r]));

  /** The live terminals in listed repositories. A session tmux has that is not one of ours is not shown. */
  async function terminals(): Promise<TerminalInfo[]> {
    if (!config.terminals) return [];
    return (await config.terminals.mux.list())
      .filter((s) => terminalNames.has(s.name))
      .map((s) => ({ name: s.name, repository: terminalNames.get(s.name)!, since: new Date(s.created).toISOString(), attached: s.attached }));
  }

  /** The listed repository a request names, or a refusal. */
  function listed(repository: unknown): string | Response {
    if (typeof repository !== "string") return refuse(400, "MALFORMED-REQUEST", "The request needs a repository.");
    let real: string;
    try { real = realpathSync(repository); } catch { return refuse(403, "REPOSITORY-NOT-ALLOWED", "That folder is not one this host runs agents in."); }
    if (!allowed.has(real)) return refuse(403, "REPOSITORY-NOT-ALLOWED", "That folder is not one this host runs agents in.");
    return real;
  }

  const busyWith = (real: string) => [...held.values()].find((h) => h.session.repository === real && h.session.status === "working");

  async function openTerminal(body: { repository?: unknown; message?: unknown; cols?: unknown; rows?: unknown }): Promise<Response> {
    if (!config.terminals) return refuse(501, "UNSUPPORTED", "This host was started without terminals.");
    const real = listed(body.repository);
    if (typeof real !== "string") return real;
    const message = typeof body.message === "string" ? body.message.slice(0, 20000) : "";
    const name = terminalName(real);
    const live = (await terminals()).find((t) => t.name === name);
    if (live) {
      // A message for a running conversation is typed at its prompt, not sent:
      // the person reads it there and presses Enter, or does not.
      if (message.trim()) await config.terminals.mux.type(name, message.replace(/\s+/g, " ").trim());
      return json(200, { terminal: live, started: false });
    }
    const busy = busyWith(real);
    if (busy) return refuse(409, "REPOSITORY-BUSY", `A headless run is working in this repository (${busy.session.id}). Two agents in one checkout overwrite each other.`);
    const size = (v: unknown, d: number) => (typeof v === "number" && v > 0 && v < 1000 ? Math.floor(v) : d);
    const command = [...(config.terminals.command ?? ["claude"]), ...(message.trim() ? ["--", message] : [])];
    await config.terminals.mux.start({ name, cwd: real, command, cols: size(body.cols, 120), rows: size(body.rows, 36) });
    const started = (await terminals()).find((t) => t.name === name)
      ?? { name, repository: real, since: new Date().toISOString(), attached: 0 };
    return json(201, { terminal: started, started: true });
  }

  function launch(body: { repository?: unknown; task?: unknown }): Response {
    if (typeof body.repository !== "string" || typeof body.task !== "string" || !body.task.trim()) {
      return refuse(400, "MALFORMED-REQUEST", "A launch needs a repository and a task.");
    }
    if (body.task.length > 20000) return refuse(400, "MALFORMED-REQUEST", "The task is longer than 20000 characters.");
    let real: string;
    try { real = realpathSync(body.repository); } catch { return refuse(403, "REPOSITORY-NOT-ALLOWED", "That folder is not one this host runs agents in."); }
    if (!allowed.has(real)) return refuse(403, "REPOSITORY-NOT-ALLOWED", "That folder is not one this host runs agents in.");
    const busy = busyWith(real);
    if (busy) return refuse(409, "REPOSITORY-BUSY", `A session is already working in this repository (${busy.session.id}). Two agents in one checkout overwrite each other.`);

    const session: Session = { id: randomUUID(), task: body.task, repository: real, status: "working", since: new Date().toISOString() };
    const h: Held = { session, running: null, events: [], listeners: new Set() };
    held.set(session.id, h);
    publish(h, { type: "status", status: "working", since: session.since });
    h.running = config.runner.start({ cwd: real, task: body.task }, { output: (text) => publish(h, { type: "output", text }) });
    void h.running.finished.then((outcome) => {
      const status = outcome.stopped ? "idle" : outcome.ok ? "finished" : "failed";
      setStatus(h, status, outcome.message);
      publish(h, { type: "end", status, error: outcome.message });
      h.running = null;
      trim();
    });
    trim();
    return json(202, { session });
  }

  function events(h: Held): Response {
    const encoder = new TextEncoder();
    let listener: (e: HostEvent) => void = () => {};
    const stream = new ReadableStream({
      start(controller) {
        const send = (e: HostEvent) => {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(e)}\n\n`));
          if (e.type === "end") { h.listeners.delete(listener); controller.close(); }
        };
        listener = send;
        controller.enqueue(encoder.encode(": connected\n\n"));
        for (const past of h.events) send(past);
        if (h.session.status === "working") h.listeners.add(listener);
      },
      cancel() { h.listeners.delete(listener); },
    });
    return new Response(stream, { headers: { "content-type": "text/event-stream", "cache-control": "no-cache" } });
  }

  const handle: HostHandler = async function handle(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (!url.pathname.startsWith("/host/v1/")) return refuse(404, "NOT-FOUND", "Not a /host/v1/ path.");
    if (!tokenMatches(request.headers.get("authorization"), config.token)) return refuse(401, "UNAUTHORIZED", "A bearer token is required.");
    const [route, id, action] = url.pathname.slice("/host/v1/".length).split("/");

    if (route === "capabilities" && request.method === "GET") {
      const login = config.login ? await config.login().catch(() => null) : undefined;
      return json(200, {
        supported: ["list", "launch", "stop", "status", "subscribe", ...(config.terminals ? ["terminal"] : [])],
        notes: { approve: "This host answers no permission prompts in a headless run: an action that would ask is refused. In a terminal the person answers them." },
        ...(login !== undefined ? { login } : {}),
      });
    }
    if (route === "terminals") {
      if (!id && request.method === "GET") return json(200, { terminals: await terminals() });
      if (!id && request.method === "POST") {
        const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
        if (!body) return refuse(400, "MALFORMED-REQUEST", "The request body is not JSON.");
        return openTerminal(body);
      }
      if (id && action === "close" && request.method === "POST") {
        if (!config.terminals || !terminalNames.has(id)) return refuse(404, "NO-SUCH-TERMINAL", `No terminal ${id}.`);
        await config.terminals.mux.close(id);
        return json(200, { closed: true });
      }
      return refuse(405, "METHOD-NOT-ALLOWED", "No such method on this route.");
    }
    if (route !== "sessions") return refuse(404, "NOT-FOUND", `No route ${url.pathname}.`);

    if (!id) {
      if (request.method === "GET") return json(200, { sessions: [...held.values()].map((h) => h.session).reverse() });
      if (request.method === "POST") {
        const body = (await request.json().catch(() => null)) as { repository?: unknown; task?: unknown } | null;
        if (!body) return refuse(400, "MALFORMED-REQUEST", "The request body is not JSON.");
        if (typeof body.repository === "string") {
          const real = listed(body.repository);
          if (typeof real === "string" && (await terminals()).some((t) => t.repository === real)) {
            return refuse(409, "REPOSITORY-BUSY", "A terminal is open in this repository. Two agents in one checkout overwrite each other; close it or ask there.");
          }
        }
        return launch(body);
      }
      return refuse(405, "METHOD-NOT-ALLOWED", "Use GET or POST.");
    }
    const h = held.get(id);
    if (!h) return refuse(404, "NO-SUCH-SESSION", `No session ${id}.`);
    if (!action && request.method === "GET") return json(200, { session: h.session });
    if (action === "events" && request.method === "GET") return events(h);
    if (action === "stop" && request.method === "POST") {
      if (h.session.status !== "working" || !h.running) return json(200, { stopped: false, status: h.session.status });
      h.running.stop();
      return json(200, { stopped: true });
    }
    return refuse(405, "METHOD-NOT-ALLOWED", "No such method on this route.");
  };

  if (config.terminals) {
    const mux = config.terminals.mux;
    const sockets = new WebSocketServer({ noServer: true, maxPayload: 1 << 20 });
    const reject = (socket: Duplex, status: string) => { socket.end(`HTTP/1.1 ${status}\r\nconnection: close\r\ncontent-length: 0\r\n\r\n`); };
    handle.upgrade = (message, socket, head) => {
      const url = new URL(message.url ?? "/", "http://host");
      const match = /^\/host\/v1\/terminals\/([^/]+)\/io$/.exec(url.pathname);
      if (!match) return reject(socket, "404 Not Found");
      if (!tokenMatches(message.headers.authorization ?? null, config.token)) return reject(socket, "401 Unauthorized");
      const name = decodeURIComponent(match[1]!);
      void terminals().then((live) => {
        if (!live.some((t) => t.name === name)) return reject(socket, "404 Not Found");
        const dim = (k: string, d: number) => { const n = Number(url.searchParams.get(k)); return n > 0 && n < 1000 ? Math.floor(n) : d; };
        sockets.handleUpgrade(message, socket, head, (ws) => {
          const attached = mux.attach(name, dim("cols", 120), dim("rows", 36));
          attached.onData((data) => { if (ws.readyState === ws.OPEN) ws.send(data, { binary: true }); });
          attached.onExit(() => ws.close(1000, "the terminal ended"));
          ws.on("message", (data, binary) => {
            const bytes = Array.isArray(data) ? Buffer.concat(data) : Buffer.from(data as ArrayBuffer);
            if (binary) return attached.write(bytes);
            try {
              const control = JSON.parse(bytes.toString("utf8"));
              if (control.type === "resize") attached.resize(Number(control.cols), Number(control.rows));
            } catch { /* not a control message */ }
          });
          ws.on("close", () => attached.close());
        });
      }, () => reject(socket, "500 Internal Server Error"));
    };
  }
  return handle;
}
