import { createServer, type Server } from "node:http";

export interface Recorded { method: string; url: string; host: string; authorization?: string; body: string }

/** A stand-in for the Synoptik service: records what it receives, answers from `routes`. */
export async function fakeService(routes: Record<string, (r: Recorded) => { status?: number; body: unknown }> = {}) {
  const seen: Recorded[] = [];
  const server: Server = createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      const recorded = { method: req.method!, url: req.url!, host: req.headers.host!, authorization: req.headers.authorization, body };
      seen.push(recorded);
      const key = new URL(req.url!, "http://x").pathname;
      const route = routes[key] ?? (() => ({ body: { ok: true } }));
      const answer = route(recorded);
      res.writeHead(answer.status ?? 200, { "content-type": "application/json" }).end(JSON.stringify(answer.body));
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const port = (server.address() as any).port as number;
  return { url: `http://127.0.0.1:${port}`, host: `127.0.0.1:${port}`, seen, close: () => new Promise<void>((r) => server.close(() => r())) };
}
