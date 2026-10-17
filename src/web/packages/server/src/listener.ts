import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { createServer, type IncomingMessage, type Server } from "node:http";
import { extname, join, normalize, sep } from "node:path";
import { Readable } from "node:stream";
import { assertBindable } from "./auth.js";

const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css",
  ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png", ".ico": "image/x-icon",
};

export interface ListenerConfig {
  host: string;
  port: number;
  token?: string;
  handler: (request: Request) => Promise<Response>;
  /** A directory of static files served for every path outside /api/. */
  staticDir?: string;
}

function toRequest(message: IncomingMessage, host: string): Request {
  const headers = new Headers();
  for (const [key, value] of Object.entries(message.headers)) {
    if (Array.isArray(value)) value.forEach((v) => headers.append(key, v)); else if (value !== undefined) headers.set(key, value);
  }
  const method = message.method ?? "GET";
  const init: RequestInit & { duplex?: "half" } = { method, headers };
  if (method !== "GET" && method !== "HEAD") { init.body = Readable.toWeb(message) as any; init.duplex = "half"; }
  return new Request(`http://${message.headers.host ?? host}${message.url ?? "/"}`, init);
}

/** Serve FILE under DIR, or null when it is outside DIR or absent. Traversal is refused here. */
async function staticFile(dir: string, pathname: string) {
  const relative = normalize(decodeURIComponent(pathname)).replace(/^([/\\])+/, "");
  const full = join(dir, relative === "" ? "index.html" : relative);
  if (full !== dir && !full.startsWith(dir + sep)) return null;
  const info = await stat(full).catch(() => null);
  if (!info) return null;
  if (info.isDirectory()) return staticFile(dir, join(relative, "index.html"));
  return full;
}

export async function startListener(config: ListenerConfig): Promise<Server> {
  assertBindable(config.host, config.token);
  const server = createServer(async (message, reply) => {
    try {
      const url = new URL(message.url ?? "/", `http://${config.host}`);
      if (url.pathname.startsWith("/api/")) {
        const response = await config.handler(toRequest(message, config.host));
        reply.writeHead(response.status, Object.fromEntries(response.headers));
        if (response.body) {
          const stream = Readable.fromWeb(response.body as any);
          reply.on("close", () => stream.destroy());
          stream.pipe(reply);
        } else reply.end();
        return;
      }
      if (config.staticDir) {
        const file = await staticFile(config.staticDir, url.pathname);
        if (file) {
          reply.writeHead(200, { "content-type": TYPES[extname(file)] ?? "application/octet-stream" });
          createReadStream(file).pipe(reply);
          return;
        }
      }
      reply.writeHead(404, { "content-type": "application/json" }).end(JSON.stringify({ name: "NOT-FOUND" }));
    } catch (error: any) {
      reply.writeHead(500, { "content-type": "application/json" }).end(JSON.stringify({ name: "INTERNAL", message: String(error?.message ?? error) }));
    }
  });
  await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(config.port, config.host, resolve); });
  return server;
}
