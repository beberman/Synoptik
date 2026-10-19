import { mkdtempSync, mkdirSync, realpathSync, rmSync } from "node:fs";
import type { IncomingMessage, Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { WebSocket } from "ws";
import { HostAdapter } from "../../agents/src/index.js";
import { createHostHandler, listen, type Attachment, type Multiplexer, type Outcome } from "../../agent-host/src/index.js";
import { Stores, createHandler, createTerminalProxy, startListener, upgradeAllowed } from "../src/index.js";

const HOST_TOKEN = "host-token";
const cleanup: (() => unknown)[] = [];
// Last made, first undone: a socket closes before the server it is open on.
afterEach(async () => { for (const c of cleanup.splice(0).reverse()) await c(); });

const asMessage = (headers: Record<string, string>) => ({ headers }) as unknown as IncomingMessage;

describe("who may open a terminal's WebSocket", () => {
  it("refuses a page of another origin, with or without a token", () => {
    expect(upgradeAllowed(asMessage({ host: "127.0.0.1:4790", origin: "https://evil.example" }), undefined)).toEqual({ ok: false, status: "403 Forbidden" });
    expect(upgradeAllowed(asMessage({ host: "127.0.0.1:4790", origin: "http://127.0.0.1:4791" }), undefined).ok).toBe(false);
    expect(upgradeAllowed(asMessage({ host: "ui.lan:4790", origin: "https://evil.example", "sec-websocket-protocol": "synoptik-token.abc" }), "abc").ok).toBe(false);
  });

  it("without a token, answers only on a loopback name", () => {
    expect(upgradeAllowed(asMessage({ host: "127.0.0.1:4790", origin: "http://127.0.0.1:4790" }), undefined).ok).toBe(true);
    expect(upgradeAllowed(asMessage({ host: "localhost:4790" }), undefined).ok).toBe(true);
    expect(upgradeAllowed(asMessage({ host: "192.168.1.5:4790", origin: "http://192.168.1.5:4790" }), undefined).ok).toBe(false);
  });

  it("with a token, needs it as the subprotocol and names that protocol to echo", () => {
    const at = { host: "ui.lan:4790", origin: "http://ui.lan:4790" };
    expect(upgradeAllowed(asMessage(at), "abc")).toEqual({ ok: false, status: "401 Unauthorized" });
    expect(upgradeAllowed(asMessage({ ...at, "sec-websocket-protocol": "synoptik-token.abd" }), "abc").ok).toBe(false);
    expect(upgradeAllowed(asMessage({ ...at, "sec-websocket-protocol": "synoptik-token.abc" }), "abc")).toEqual({ ok: true, protocol: "synoptik-token.abc" });
  });
});

class EchoMux implements Multiplexer {
  sessions = new Map<string, string>();
  async list() { return [...this.sessions].map(([name, path]) => ({ name, path, created: Date.now(), attached: 0 })); }
  async start(o: { name: string; cwd: string }) { this.sessions.set(o.name, o.cwd); }
  async type() {}
  async close(name: string) { this.sessions.delete(name); }
  attach(): Attachment {
    const listeners: ((d: Buffer) => void)[] = [];
    return { write: (d) => listeners.forEach((l) => l(Buffer.concat([Buffer.from("echo:"), d]))), resize: () => {}, onData: (l) => { listeners.push(l); }, onExit: () => {}, close: () => {} };
  }
}

async function stack(token?: string) {
  const dir = mkdtempSync(join(tmpdir(), "proxy-repo-")); mkdirSync(join(dir, ".git"));
  const home = mkdtempSync(join(tmpdir(), "proxy-home-"));
  cleanup.push(() => { rmSync(dir, { recursive: true, force: true }); rmSync(home, { recursive: true, force: true }); });
  const pending = { start: () => ({ finished: new Promise<Outcome>(() => {}), stop: () => {} }) };
  const host: Server = await listen("127.0.0.1", 0, createHostHandler({ token: HOST_TOKEN, repositories: [dir], runner: pending, terminals: { mux: new EchoMux() } }));
  cleanup.push(() => new Promise<void>((r) => { host.closeAllConnections(); host.close(() => r()); }));
  const adapters = [new HostAdapter({ baseUrl: `http://127.0.0.1:${(host.address() as { port: number }).port}`, token: HOST_TOKEN })];
  const ui: Server = await startListener({
    host: "127.0.0.1", port: 0, token, upgrade: createTerminalProxy({ token, adapters }),
    handler: createHandler({ serviceUrl: "http://127.0.0.1:1", token, stores: new Stores(join(home, ".synoptik")), adapters }),
  });
  cleanup.push(() => new Promise<void>((r) => { ui.closeAllConnections(); ui.close(() => r()); }));
  const origin = `http://127.0.0.1:${(ui.address() as { port: number }).port}`;
  return { repository: realpathSync(dir), origin };
}

const connect = (url: string, options: { origin?: string; protocols?: string[] } = {}) =>
  new Promise<{ ws?: WebSocket; status: number }>((resolve) => {
    const ws = new WebSocket(url, options.protocols ?? [], { origin: options.origin });
    ws.on("unexpected-response", (_q, response) => resolve({ status: response.statusCode ?? 0 }));
    ws.on("error", () => resolve({ status: 0 }));
    ws.on("open", () => { cleanup.push(() => ws.close()); resolve({ ws, status: 101 }); });
  });

describe("the web server's terminal proxy", () => {
  it("opens a terminal through the adapter and relays its bytes to this server's own page", async () => {
    const { repository, origin } = await stack();
    const opened = await fetch(`${origin}/api/agents/host/terminals`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ repository, message: "hello" }) });
    expect(opened.status).toBe(200);
    const { terminal } = await opened.json();
    const url = `${origin.replace("http", "ws")}/api/agents/host/terminals/${terminal.name}/io`;

    expect((await connect(url, { origin: "https://evil.example" })).status).toBe(403);
    const { ws, status } = await connect(url, { origin });
    expect(status).toBe(101);
    const reply = new Promise<string>((r) => ws!.once("message", (d) => r(d.toString())));
    ws!.send(Buffer.from("yes"), { binary: true });
    expect(await reply).toBe("echo:yes");
  });

  it("fails the connection for a terminal the host does not have", async () => {
    const { origin } = await stack();
    expect((await connect(`${origin.replace("http", "ws")}/api/agents/host/terminals/synoptik-none-00000000/io`, { origin })).status).toBe(404);
  });

  it("with a token, refuses a connection without it and accepts the one that carries it", async () => {
    const token = "0123abcd";
    const { repository, origin } = await stack(token);
    const opened = await fetch(`${origin}/api/agents/host/terminals`, {
      method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${token}` }, body: JSON.stringify({ repository }),
    });
    const { terminal } = await opened.json();
    const url = `${origin.replace("http", "ws")}/api/agents/host/terminals/${terminal.name}/io`;
    expect((await connect(url, { origin })).status).toBe(401);
    const { ws, status } = await connect(url, { origin, protocols: [`synoptik-token.${token}`] });
    expect(status).toBe(101);
    expect(ws!.protocol).toBe(`synoptik-token.${token}`);
  });
});
