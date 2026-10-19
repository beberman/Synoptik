import { randomUUID, timingSafeEqual } from "node:crypto";
import { realpathSync } from "node:fs";
import type { HostEvent, Runner, RunningAgent, Session } from "./types.js";

export interface HostConfig {
  /** Required on every request. */
  token: string;
  /** The repositories agents may run in, as real paths. */
  repositories: string[];
  runner: Runner;
  /** How many finished sessions are kept for listing. */
  keep?: number;
}

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
export function createHostHandler(config: HostConfig) {
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

  function launch(body: { repository?: unknown; task?: unknown }): Response {
    if (typeof body.repository !== "string" || typeof body.task !== "string" || !body.task.trim()) {
      return refuse(400, "MALFORMED-REQUEST", "A launch needs a repository and a task.");
    }
    if (body.task.length > 20000) return refuse(400, "MALFORMED-REQUEST", "The task is longer than 20000 characters.");
    let real: string;
    try { real = realpathSync(body.repository); } catch { return refuse(403, "REPOSITORY-NOT-ALLOWED", "That folder is not one this host runs agents in."); }
    if (!allowed.has(real)) return refuse(403, "REPOSITORY-NOT-ALLOWED", "That folder is not one this host runs agents in.");
    const busy = [...held.values()].find((h) => h.session.repository === real && h.session.status === "working");
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

  return async function handle(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (!url.pathname.startsWith("/host/v1/")) return refuse(404, "NOT-FOUND", "Not a /host/v1/ path.");
    if (!tokenMatches(request.headers.get("authorization"), config.token)) return refuse(401, "UNAUTHORIZED", "A bearer token is required.");
    const [route, id, action] = url.pathname.slice("/host/v1/".length).split("/");

    if (route === "capabilities" && request.method === "GET") {
      return json(200, {
        supported: ["list", "launch", "stop", "status", "subscribe"],
        notes: { approve: "This host answers no permission prompts: an action that would ask is refused." },
      });
    }
    if (route !== "sessions") return refuse(404, "NOT-FOUND", `No route ${url.pathname}.`);

    if (!id) {
      if (request.method === "GET") return json(200, { sessions: [...held.values()].map((h) => h.session).reverse() });
      if (request.method === "POST") {
        const body = (await request.json().catch(() => null)) as { repository?: unknown; task?: unknown } | null;
        if (!body) return refuse(400, "MALFORMED-REQUEST", "The request body is not JSON.");
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
}
