import type { IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";
import type { AgentController } from "@synoptik/agents";
import { WebSocket, WebSocketServer } from "ws";
import { bearerMatches, isLoopback } from "./auth.js";

// The terminal's WebSocket (REQ-0080 R23, DES-0057 D21). The browser connects
// here, and the bytes go on to the adapter's own socket with the adapter's
// credential, which the browser never sees.

export interface TerminalProxyConfig {
  token?: string;
  adapters: AgentController[];
}

/** The subprotocol that carries the server's token, because a browser's WebSocket cannot send a header. */
export const TOKEN_PROTOCOL = "synoptik-token.";

const reject = (socket: Duplex, status: string) => {
  socket.end(`HTTP/1.1 ${status}\r\nconnection: close\r\ncontent-length: 0\r\n\r\n`);
};

/**
 * The same two checks the HTTP routes make, for an upgrade: a browser's Origin
 * must be this server, or any page the person has open could type into the
 * agent; and the token when there is one, or a loopback Host when there is not.
 */
export function upgradeAllowed(message: IncomingMessage, token: string | undefined): { ok: true; protocol?: string } | { ok: false; status: string } {
  const host = message.headers.host ?? "";
  const origin = message.headers.origin;
  if (origin) {
    let originHost: string;
    try { originHost = new URL(origin).host; } catch { return { ok: false, status: "403 Forbidden" }; }
    if (originHost !== host) return { ok: false, status: "403 Forbidden" };
  }
  if (token) {
    const offered = String(message.headers["sec-websocket-protocol"] ?? "").split(",").map((p) => p.trim());
    const protocol = offered.find((p) => p.startsWith(TOKEN_PROTOCOL));
    if (!protocol || !bearerMatches(`Bearer ${protocol.slice(TOKEN_PROTOCOL.length)}`, token)) return { ok: false, status: "401 Unauthorized" };
    return { ok: true, protocol };
  }
  const name = host.replace(/:\d+$/, "").replace(/^\[|\]$/g, "");
  if (!isLoopback(name)) return { ok: false, status: "403 Forbidden" };
  return { ok: true };
}

export function createTerminalProxy(config: TerminalProxyConfig) {
  const sockets = new WebSocketServer({
    noServer: true,
    maxPayload: 1 << 20,
    // The browser offered the token as a subprotocol; it fails the connection
    // unless one of its offers is echoed back.
    handleProtocols: (protocols) => [...protocols].find((p) => p.startsWith(TOKEN_PROTOCOL)) ?? false,
  });

  return function upgrade(message: IncomingMessage, socket: Duplex, head: Buffer): void {
    const url = new URL(message.url ?? "/", "http://ui");
    const match = /^\/api\/agents\/([^/]+)\/terminals\/([^/]+)\/io$/.exec(url.pathname);
    if (!match) return reject(socket, "404 Not Found");
    const allowed = upgradeAllowed(message, config.token);
    if (!allowed.ok) return reject(socket, allowed.status);
    const adapter = config.adapters.find((a) => a.id === match[1]);
    if (!adapter) return reject(socket, "404 Not Found");
    const dim = (k: string, d: number) => { const n = Number(url.searchParams.get(k)); return n > 0 && n < 1000 ? Math.floor(n) : d; };
    let target;
    try { target = adapter.terminalSocket(decodeURIComponent(match[2]!), dim("cols", 120), dim("rows", 36)); }
    catch { return reject(socket, "501 Not Implemented"); }

    // Connect upstream first, so a terminal that is gone fails the browser's
    // connection instead of opening one that closes at once.
    const upstream = new WebSocket(target.url, { headers: target.headers });
    let upgraded = false;
    upstream.once("unexpected-response", (_req, response) => reject(socket, response.statusCode === 404 ? "404 Not Found" : "502 Bad Gateway"));
    upstream.on("error", () => { if (!upgraded) reject(socket, "502 Bad Gateway"); });
    upstream.once("open", () => {
      upgraded = true;
      sockets.handleUpgrade(message, socket, head, (browser) => {
        browser.on("message", (data, binary) => { if (upstream.readyState === WebSocket.OPEN) upstream.send(data, { binary }); });
        upstream.on("message", (data, binary) => { if (browser.readyState === WebSocket.OPEN) browser.send(data, { binary }); });
        browser.on("close", () => upstream.close());
        // 1005 and 1006 mean no code was sent, and may not be sent on.
        upstream.on("close", (code, reason) => browser.close(code === 1005 || code === 1006 ? 1000 : code, reason));
        upstream.on("error", () => browser.close(1011));
      });
    });
  };
}
