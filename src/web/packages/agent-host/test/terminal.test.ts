import { spawn } from "node:child_process";
import { mkdtempSync, mkdirSync, realpathSync, rmSync } from "node:fs";
import type { Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { WebSocket } from "ws";
import { createHostHandler, listen, terminalName, type Attachment, type Multiplexer, type Outcome, type Runner } from "../src/index.js";

const TOKEN = "terminal-token";
const cleanup: (() => unknown)[] = [];
// Last made, first undone: a socket closes before the server it is open on.
afterEach(async () => { for (const c of cleanup.splice(0).reverse()) await c(); });

const repo = (name = "repo-") => {
  const d = mkdtempSync(join(tmpdir(), name)); mkdirSync(join(d, ".git"));
  cleanup.push(() => rmSync(d, { recursive: true, force: true }));
  return realpathSync(d);
};

/** tmux, as far as the host can tell: sessions by name, and an attachment that echoes. */
class FakeMux implements Multiplexer {
  sessions = new Map<string, { path: string; command: string[]; cols: number; rows: number }>();
  typed: { name: string; text: string }[] = [];
  closed: string[] = [];
  resizes: [number, number][] = [];
  detached = 0;
  async list() { return [...this.sessions].map(([name, s]) => ({ name, path: s.path, created: 1_700_000_000_000, attached: 0 })); }
  async start(o: { name: string; cwd: string; command: string[]; cols: number; rows: number }) { this.sessions.set(o.name, { path: o.cwd, command: o.command, cols: o.cols, rows: o.rows }); }
  async type(name: string, text: string) { this.typed.push({ name, text }); }
  async close(name: string) { this.closed.push(name); this.sessions.delete(name); }
  attach(_name: string, cols: number, rows: number): Attachment {
    this.resizes.push([cols, rows]);
    const listeners: ((d: Buffer) => void)[] = [];
    return {
      write: (data) => { for (const l of listeners) l(Buffer.concat([Buffer.from("echo:"), data])); },
      resize: (c, r) => { this.resizes.push([c, r]); },
      onData: (l) => { listeners.push(l); },
      onExit: () => {},
      close: () => { this.detached++; },
    };
  }
}

/** A headless runner that works until the test says otherwise. */
class Pending implements Runner {
  end: ((o: Outcome) => void) | null = null;
  start() { return { finished: new Promise<Outcome>((r) => { this.end = r; }), stop: () => this.end?.({ ok: false, stopped: true }) }; }
}

const call = (handler: (r: Request) => Promise<Response>, method: string, path: string, body?: unknown) =>
  handler(new Request(`http://host${path}`, {
    method, headers: { authorization: `Bearer ${TOKEN}`, ...(body ? { "content-type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  }));

describe("the agent host's terminals", () => {
  it("names a terminal by the folder and a hash of the real path, in characters tmux accepts", () => {
    const name = terminalName("/home/someone/lisp/My Repo.v2");
    expect(name).toMatch(/^synoptik-My_Repo_v2-[0-9a-f]{8}$/);
    expect(terminalName("/a/x")).not.toBe(terminalName("/b/x"));
    expect(terminalName("/a/x")).toBe(terminalName("/a/x"));
  });

  it("offers a terminal and the login only when it was given them, and reports no other login field", async () => {
    const without = createHostHandler({ token: TOKEN, repositories: [repo()], runner: new Pending() });
    expect((await (await call(without, "GET", "/host/v1/capabilities")).json()).supported).not.toContain("terminal");
    const handler = createHostHandler({
      token: TOKEN, repositories: [repo()], runner: new Pending(),
      terminals: { mux: new FakeMux() }, login: async () => ({ loggedIn: true, authMethod: "claude.ai" }),
    });
    const body = await (await call(handler, "GET", "/host/v1/capabilities")).json();
    expect(body.supported).toContain("terminal");
    expect(body.login).toEqual({ loggedIn: true, authMethod: "claude.ai" });
  });

  it("starts Claude Code with the first message, then types a later one at the prompt without starting another", async () => {
    const dir = repo();
    const mux = new FakeMux();
    const handler = createHostHandler({ token: TOKEN, repositories: [dir], runner: new Pending(), terminals: { mux, command: ["claude"] } });
    const first = await call(handler, "POST", "/host/v1/terminals", { repository: dir, message: "-rf is a task, not an option", cols: 100, rows: 30 });
    expect(first.status).toBe(201);
    const { terminal, started } = await first.json();
    expect(started).toBe(true);
    expect(terminal).toMatchObject({ name: terminalName(dir), repository: dir });
    expect(mux.sessions.get(terminal.name)).toEqual({ path: dir, command: ["claude", "--", "-rf is a task, not an option"], cols: 100, rows: 30 });

    const again = await call(handler, "POST", "/host/v1/terminals", { repository: dir, message: "and\nthis" });
    expect(again.status).toBe(200);
    expect((await again.json()).started).toBe(false);
    expect(mux.sessions.size).toBe(1);
    expect(mux.typed).toEqual([{ name: terminal.name, text: "and this" }]);

    const listed = await (await call(handler, "GET", "/host/v1/terminals")).json();
    expect(listed.terminals.map((t: { name: string }) => t.name)).toEqual([terminal.name]);
  });

  it("refuses a repository not on its list, and lists no tmux session that is not one of its own", async () => {
    const mux = new FakeMux();
    mux.sessions.set("synoptik-elsewhere-00000000", { path: "/tmp", command: [], cols: 1, rows: 1 });
    const handler = createHostHandler({ token: TOKEN, repositories: [repo()], runner: new Pending(), terminals: { mux } });
    expect((await call(handler, "POST", "/host/v1/terminals", { repository: repo("other-") })).status).toBe(403);
    expect((await (await call(handler, "GET", "/host/v1/terminals")).json()).terminals).toEqual([]);
    expect((await call(handler, "POST", "/host/v1/terminals/synoptik-elsewhere-00000000/close", {})).status).toBe(404);
  });

  it("keeps one agent to a checkout: no headless run beside a terminal, and no terminal beside a working run", async () => {
    const a = repo(), b = repo();
    const mux = new FakeMux();
    const runner = new Pending();
    const handler = createHostHandler({ token: TOKEN, repositories: [a, b], runner, terminals: { mux } });
    await call(handler, "POST", "/host/v1/terminals", { repository: a });
    expect((await call(handler, "POST", "/host/v1/sessions", { repository: a, task: "fix" })).status).toBe(409);

    expect((await call(handler, "POST", "/host/v1/sessions", { repository: b, task: "fix" })).status).toBe(202);
    expect((await call(handler, "POST", "/host/v1/terminals", { repository: b })).status).toBe(409);
    runner.end!({ ok: true, stopped: false });
    await new Promise((r) => setTimeout(r, 20));
    expect((await call(handler, "POST", "/host/v1/terminals", { repository: b })).status).toBe(201);
  });

  it("ends a terminal on close", async () => {
    const dir = repo();
    const mux = new FakeMux();
    const handler = createHostHandler({ token: TOKEN, repositories: [dir], runner: new Pending(), terminals: { mux } });
    await call(handler, "POST", "/host/v1/terminals", { repository: dir });
    expect((await call(handler, "POST", `/host/v1/terminals/${terminalName(dir)}/close`, {})).status).toBe(200);
    expect(mux.closed).toEqual([terminalName(dir)]);
  });

  it("relays a terminal's bytes and sizes over a WebSocket that needs the token", async () => {
    const dir = repo();
    const mux = new FakeMux();
    const server: Server = await listen("127.0.0.1", 0, createHostHandler({ token: TOKEN, repositories: [dir], runner: new Pending(), terminals: { mux } }));
    cleanup.push(() => new Promise<void>((r) => server.close(() => r())));
    const port = (server.address() as { port: number }).port;
    const name = terminalName(dir);
    await mux.start({ name, cwd: dir, command: [], cols: 80, rows: 24 });
    const address = `ws://127.0.0.1:${port}/host/v1/terminals/${name}/io?cols=90&rows=20`;

    const refused = await new Promise<number>((resolve) => {
      const ws = new WebSocket(address);
      ws.on("unexpected-response", (_q, response) => resolve(response.statusCode ?? 0));
      ws.on("open", () => resolve(101));
    });
    expect(refused).toBe(401);

    const ws = new WebSocket(address, { headers: { authorization: `Bearer ${TOKEN}` } });
    cleanup.push(() => ws.close());
    await new Promise((r) => ws.on("open", r));
    const reply = new Promise<string>((r) => ws.once("message", (d) => r(d.toString())));
    ws.send(Buffer.from("hi"), { binary: true });
    expect(await reply).toBe("echo:hi");
    ws.send(JSON.stringify({ type: "resize", cols: 132, rows: 43 }));
    await new Promise((r) => setTimeout(r, 50));
    expect(mux.resizes).toEqual([[90, 20], [132, 43]]);

    const gone = await new Promise<number>((resolve) => {
      const other = new WebSocket(`ws://127.0.0.1:${port}/host/v1/terminals/synoptik-none-00000000/io`, { headers: { authorization: `Bearer ${TOKEN}` } });
      other.on("unexpected-response", (_q, response) => resolve(response.statusCode ?? 0));
      other.on("open", () => resolve(101));
    });
    expect(gone).toBe(404);
  });
});

describe("the pseudo-terminal bridge", () => {
  const bridge = fileURLToPath(new URL("../bridge/pty-bridge.py", import.meta.url));

  it("runs a program in a terminal of the size it was given, and changes the size when told", async () => {
    const child = spawn("python3", [bridge, "--size", "100x30", "--", "sh", "-c", "stty size; read line; stty size"], { stdio: ["pipe", "pipe", "pipe", "pipe"] });
    let out = "";
    child.stdout!.on("data", (d) => { out += d; });
    const until = async (ok: () => boolean) => { const end = Date.now() + 5000; while (!ok() && Date.now() < end) await new Promise((r) => setTimeout(r, 20)); };
    await until(() => /30 100/.test(out));
    (child.stdio[3] as NodeJS.WritableStream).write("130x50\n");
    await new Promise((r) => setTimeout(r, 100));
    child.stdin!.write("go\n");
    const code = await new Promise<number | null>((r) => child.on("close", r));
    expect(out.match(/^\d+ \d+/gm)).toEqual(["30 100", "50 130"]);
    expect(code).toBe(0);
  });
});
