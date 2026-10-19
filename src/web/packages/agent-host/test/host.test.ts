import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { ClaudeRunner, createHostHandler, listen, type Outcome, type RunHooks, type Runner } from "../src/index.js";

const fake = fileURLToPath(new URL("./fake-claude.mjs", import.meta.url));
const TOKEN = "s3cret-token";
const roots: string[] = [];
const closers: (() => unknown)[] = [];
afterEach(async () => { for (const c of closers.splice(0)) await c(); for (const r of roots.splice(0)) rmSync(r, { recursive: true, force: true }); });

const repo = () => { const d = mkdtempSync(join(tmpdir(), "host-repo-")); mkdirSync(join(d, ".git")); roots.push(d); return d; };

/** A runner a test finishes by hand. */
class Manual implements Runner {
  started: { cwd: string; task: string }[] = [];
  private end: ((o: Outcome) => void)[] = [];
  hooks: RunHooks[] = [];
  stops = 0;
  start(request: { cwd: string; task: string }, hooks: RunHooks) {
    this.started.push(request); this.hooks.push(hooks);
    const finished = new Promise<Outcome>((r) => this.end.push(r));
    return { finished, stop: () => { this.stops++; this.end[this.end.length - 1]({ ok: false, stopped: true }); } };
  }
  finish(i: number, outcome: Outcome) { this.end[i](outcome); }
}

const call = (handler: (r: Request) => Promise<Response>, method: string, path: string, body?: unknown, token: string | null = TOKEN) =>
  handler(new Request(`http://host${path}`, {
    method, headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...(body ? { "content-type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  }));
const tick = () => new Promise((r) => setTimeout(r, 20));

describe("the agent host", () => {
  it("answers nothing without the token, and nothing outside /host/v1/", async () => {
    const handler = createHostHandler({ token: TOKEN, repositories: [repo()], runner: new Manual() });
    expect((await call(handler, "GET", "/host/v1/sessions", undefined, null)).status).toBe(401);
    expect((await call(handler, "GET", "/host/v1/sessions", undefined, "wrong-token")).status).toBe(401);
    expect((await call(handler, "GET", "/host/v1/sessions", undefined, "s3cret-toke")).status).toBe(401);
    expect((await call(handler, "GET", "/elsewhere")).status).toBe(404);
    expect((await call(handler, "GET", "/host/v1/capabilities")).status).toBe(200);
  });

  it("says what it offers and what it does not", async () => {
    const handler = createHostHandler({ token: TOKEN, repositories: [repo()], runner: new Manual() });
    const body = await (await call(handler, "GET", "/host/v1/capabilities")).json();
    expect(body.supported).toEqual(["list", "launch", "stop", "status", "subscribe"]);
    expect(body.notes.approve).toMatch(/refused/);
  });

  it("runs an agent in a listed repository and reports it through to the end", async () => {
    const dir = repo();
    const runner = new Manual();
    const handler = createHostHandler({ token: TOKEN, repositories: [dir], runner });
    const launched = await call(handler, "POST", "/host/v1/sessions", { repository: dir, task: "fix it" });
    expect(launched.status).toBe(202);
    const { session } = await launched.json();
    expect(session.status).toBe("working");
    expect(runner.started[0].task).toBe("fix it");
    expect((await (await call(handler, "GET", `/host/v1/sessions/${session.id}`)).json()).session.status).toBe("working");
    runner.finish(0, { ok: true, stopped: false });
    await tick();
    expect((await (await call(handler, "GET", `/host/v1/sessions/${session.id}`)).json()).session.status).toBe("finished");
    expect((await (await call(handler, "GET", "/host/v1/sessions")).json()).sessions).toHaveLength(1);
  });

  it("refuses a repository that is not on its list, whatever the spelling", async () => {
    const dir = repo();
    const other = repo();
    const runner = new Manual();
    const handler = createHostHandler({ token: TOKEN, repositories: [dir], runner });
    expect((await call(handler, "POST", "/host/v1/sessions", { repository: other, task: "x" })).status).toBe(403);
    expect((await call(handler, "POST", "/host/v1/sessions", { repository: "/", task: "x" })).status).toBe(403);
    expect((await call(handler, "POST", "/host/v1/sessions", { repository: join(dir, ".."), task: "x" })).status).toBe(403);
    expect((await call(handler, "POST", "/host/v1/sessions", { repository: "/no/such/place", task: "x" })).status).toBe(403);
    expect(runner.started).toHaveLength(0);
    expect((await call(handler, "POST", "/host/v1/sessions", { repository: join(dir, "."), task: "x" })).status).toBe(202);
  });

  it("allows one working session in a repository and a second again once it ends", async () => {
    const dir = repo();
    const runner = new Manual();
    const handler = createHostHandler({ token: TOKEN, repositories: [dir], runner });
    await call(handler, "POST", "/host/v1/sessions", { repository: dir, task: "one" });
    const second = await call(handler, "POST", "/host/v1/sessions", { repository: dir, task: "two" });
    expect(second.status).toBe(409);
    expect(runner.started).toHaveLength(1);
    runner.finish(0, { ok: true, stopped: false });
    await tick();
    expect((await call(handler, "POST", "/host/v1/sessions", { repository: dir, task: "two" })).status).toBe(202);
  });

  it("refuses an empty task, a task that is not text, and a body that is not JSON", async () => {
    const dir = repo();
    const handler = createHostHandler({ token: TOKEN, repositories: [dir], runner: new Manual() });
    expect((await call(handler, "POST", "/host/v1/sessions", { repository: dir, task: "  " })).status).toBe(400);
    expect((await call(handler, "POST", "/host/v1/sessions", { repository: dir, task: 5 })).status).toBe(400);
    const bad = await handler(new Request("http://host/host/v1/sessions", { method: "POST", headers: { authorization: `Bearer ${TOKEN}` }, body: "not json" }));
    expect(bad.status).toBe(400);
  });

  it("stops a working session and reports it idle, not failed", async () => {
    const dir = repo();
    const runner = new Manual();
    const handler = createHostHandler({ token: TOKEN, repositories: [dir], runner });
    const { session } = await (await call(handler, "POST", "/host/v1/sessions", { repository: dir, task: "x" })).json();
    expect(await (await call(handler, "POST", `/host/v1/sessions/${session.id}/stop`, {})).json()).toEqual({ stopped: true });
    await tick();
    expect((await (await call(handler, "GET", `/host/v1/sessions/${session.id}`)).json()).session.status).toBe("idle");
    expect(await (await call(handler, "POST", `/host/v1/sessions/${session.id}/stop`, {})).json()).toMatchObject({ stopped: false, status: "idle" });
  });

  it("keeps why a run failed", async () => {
    const dir = repo();
    const runner = new Manual();
    const handler = createHostHandler({ token: TOKEN, repositories: [dir], runner });
    const { session } = await (await call(handler, "POST", "/host/v1/sessions", { repository: dir, task: "x" })).json();
    runner.finish(0, { ok: false, stopped: false, message: "out of credits" });
    await tick();
    expect((await (await call(handler, "GET", `/host/v1/sessions/${session.id}`)).json()).session).toMatchObject({ status: "failed", error: "out of credits" });
  });

  it("streams a session's events from the start to its end", async () => {
    const dir = repo();
    const runner = new Manual();
    const handler = createHostHandler({ token: TOKEN, repositories: [dir], runner });
    const { session } = await (await call(handler, "POST", "/host/v1/sessions", { repository: dir, task: "x" })).json();
    runner.hooks[0].output("reading the file");
    const response = await call(handler, "GET", `/host/v1/sessions/${session.id}/events`);
    setTimeout(() => runner.finish(0, { ok: true, stopped: false }), 30);
    const text = await response.text();
    const events = text.split("\n").filter((l) => l.startsWith("data: ")).map((l) => JSON.parse(l.slice(6)));
    expect(events.map((e) => e.type)).toEqual(["status", "output", "status", "end"]);
    expect(events[1].text).toBe("reading the file");
    expect(events[3].status).toBe("finished");
  });
});

describe("the Claude runner", () => {
  const run = async (task: string) => {
    const outputs: string[] = [];
    const runner = new ClaudeRunner({ command: process.execPath, prefixArgs: [fake], killAfter: 1 });
    const running = runner.start({ cwd: tmpdir(), task }, { output: (t) => outputs.push(t) });
    return { running, outputs };
  };

  it("reports a clean run as ok and passes along what the agent did", async () => {
    const { running, outputs } = await run("fix the reference");
    expect(await running.finished).toEqual({ ok: true, stopped: false });
    expect(outputs).toEqual(["Looking at the file. Read docs/a.yaml"]);
  });

  it("reports a run whose result is an error with the tool's own words", async () => {
    const { running } = await run("please fail");
    expect(await running.finished).toEqual({ ok: false, stopped: false, message: "it went wrong" });
  });

  it("reports a process that dies with what it printed on standard error", async () => {
    const { running } = await run("crash now");
    expect(await running.finished).toEqual({ ok: false, stopped: false, message: "boom: out of credits" });
  });

  it("stops a run that does not end, and does not call that a failure", async () => {
    const { running } = await run("hang");
    await tick(); await tick();
    running.stop();
    expect(await running.finished).toEqual({ ok: false, stopped: true });
  });

  it("says so when the program cannot be started", async () => {
    const runner = new ClaudeRunner({ command: "/no/such/claude" });
    const outcome = await runner.start({ cwd: tmpdir(), task: "x" }, { output() {} }).finished;
    expect(outcome.ok).toBe(false);
    expect(outcome.message).toMatch(/could not be started/);
  });

  it("passes the task after `--`, so a task that begins with a dash is not an option", async () => {
    const { running, outputs } = await run("--help me");
    expect((await running.finished).ok).toBe(true);
    expect(outputs).toHaveLength(1);
  });
});

describe("over a real socket", () => {
  it("serves the same answers", async () => {
    const dir = repo();
    const server = await listen("127.0.0.1", 0, createHostHandler({ token: TOKEN, repositories: [dir], runner: new ClaudeRunner({ command: process.execPath, prefixArgs: [fake] }) }));
    closers.push(() => new Promise<void>((r) => server.close(() => r())));
    const base = `http://127.0.0.1:${(server.address() as any).port}`;
    expect((await fetch(`${base}/host/v1/sessions`)).status).toBe(401);
    const launched = await fetch(`${base}/host/v1/sessions`, { method: "POST", headers: { authorization: `Bearer ${TOKEN}`, "content-type": "application/json" }, body: JSON.stringify({ repository: dir, task: "go" }) });
    expect(launched.status).toBe(202);
    const { session } = await launched.json();
    const events = await (await fetch(`${base}/host/v1/sessions/${session.id}/events`, { headers: { authorization: `Bearer ${TOKEN}` } })).text();
    expect(events).toContain('"type":"end"');
    expect(events).toContain('"status":"finished"');
  });
});
