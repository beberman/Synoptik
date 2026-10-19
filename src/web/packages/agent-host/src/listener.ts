import { createServer, type IncomingMessage, type Server } from "node:http";
import { Readable } from "node:stream";
import type { HostHandler } from "./host.js";

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

export async function listen(host: string, port: number, handler: ((r: Request) => Promise<Response>) & { upgrade?: HostHandler["upgrade"] }): Promise<Server> {
  const server = createServer(async (message, reply) => {
    try {
      const response = await handler(toRequest(message, host));
      reply.writeHead(response.status, Object.fromEntries(response.headers));
      if (response.body) {
        const stream = Readable.fromWeb(response.body as any);
        reply.on("close", () => stream.destroy());
        stream.pipe(reply);
      } else reply.end();
    } catch (error: any) {
      reply.writeHead(500, { "content-type": "application/json" }).end(JSON.stringify({ name: "INTERNAL", message: String(error?.message ?? error) }));
    }
  });
  // A terminal's WebSocket. Without a terminal handler an upgrade is refused.
  server.on("upgrade", (message, socket, head) => {
    if (handler.upgrade) handler.upgrade(message, socket, head);
    else socket.end("HTTP/1.1 404 Not Found\r\nconnection: close\r\ncontent-length: 0\r\n\r\n");
  });
  await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(port, host, resolve); });
  return server;
}
