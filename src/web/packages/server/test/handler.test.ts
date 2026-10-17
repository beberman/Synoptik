import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Stores, assertBindable, createHandler, restoreWorkspace, startListener } from "../src/index.js";
import { fakeService } from "./fake-service.js";

let home: string, roots: string, service: Awaited<ReturnType<typeof fakeService>>, stores: Stores;

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), "synoptik-web-home-"));
  roots = await mkdtemp(join(tmpdir(), "synoptik-web-roots-"));
  await mkdir(join(roots, "game-server", ".git"), { recursive: true });
  await mkdir(join(roots, "notes"), { recursive: true });
  stores = new Stores(join(home, ".synoptik"));
  service = await fakeService({
    "/v1/status": () => ({ body: { name: "game-server", root: join(roots, "game-server") + "/" } }),
    "/v1/watch": () => ({ body: { name: "game-server" } }),
    "/v1/write-document": () => ({ status: 409, body: { name: "VERSION-CONFLICT", message: "changed", current: { text: "t", version: "v" } } }),
  });
});
afterEach(async () => {
  await service.close();
  await rm(home, { recursive: true, force: true });
  await rm(roots, { recursive: true, force: true });
});

const get = (h: ReturnType<typeof createHandler>, path: string, init: RequestInit = {}) =>
  h(new Request(`http://127.0.0.1:4790${path}`, { headers: { host: "127.0.0.1:4790", ...(init.headers as object) }, ...init }));
const post = (h: ReturnType<typeof createHandler>, path: string, body: unknown, headers: Record<string, string> = {}) =>
  get(h, path, { method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json", ...headers } });

describe("the allow list", () => {
  it.each(["init", "remove", "architecture", "embed", "repl-eval", "context-used", "nonsense"])("refuses %s", async (operation) => {
    const h = createHandler({ serviceUrl: service.url, stores });
    const response = await post(h, `/api/v1/${operation}`, {});
    expect(response.status).toBe(403);
    expect(service.seen).toHaveLength(0);
  });

  it("forwards a read with its query and a write with its body", async () => {
    const h = createHandler({ serviceUrl: service.url, stores });
    await get(h, "/api/v1/documents?repository=Synoptik");
    await post(h, "/api/v1/set-status", { repository: "Synoptik", document: "REQ-1", status: "accepted" });
    expect(service.seen[0]).toMatchObject({ method: "GET", url: "/v1/documents?repository=Synoptik" });
    expect(service.seen[1]).toMatchObject({ method: "POST", url: "/v1/set-status" });
    expect(JSON.parse(service.seen[1]!.body)).toMatchObject({ status: "accepted" });
  });

  it("refuses a write sent as GET", async () => {
    const h = createHandler({ serviceUrl: service.url, stores });
    expect((await get(h, "/api/v1/set-status?document=x")).status).toBe(405);
  });
});

describe("forwarding", () => {
  it("sends the service's own loopback name as Host and no caller credential", async () => {
    const h = createHandler({ serviceUrl: service.url, stores, token: "secret" });
    await get(h, "/api/v1/documents", { headers: { authorization: "Bearer secret", host: "my.lan:9000" } });
    expect(service.seen[0]!.host).toBe(service.host);
    expect(service.seen[0]!.authorization).toBeUndefined();
  });

  it("passes a 409 and its stored text through", async () => {
    const h = createHandler({ serviceUrl: service.url, stores });
    const response = await post(h, "/api/v1/write-document", { repository: "r", document: "d", text: "x", version: "1" });
    expect(response.status).toBe(409);
    expect((await response.json()).current.text).toBe("t");
  });

  it("answers 502 when the service is not there", async () => {
    await service.close();
    const h = createHandler({ serviceUrl: service.url, stores });
    expect((await get(h, "/api/v1/status")).status).toBe(502);
    service = await fakeService();
  });
});

describe("authentication", () => {
  it("refuses a missing or wrong token and accepts the right one", async () => {
    const h = createHandler({ serviceUrl: service.url, stores, token: "secret" });
    expect((await get(h, "/api/v1/documents")).status).toBe(401);
    expect((await get(h, "/api/v1/documents", { headers: { authorization: "Bearer nope" } })).status).toBe(401);
    expect((await get(h, "/api/v1/documents", { headers: { authorization: "Bearer secret" } })).status).toBe(200);
    expect((await get(h, "/api/folders")).status).toBe(401);
  });

  it("without a token refuses a non-loopback Host and a foreign Origin", async () => {
    const h = createHandler({ serviceUrl: service.url, stores });
    expect((await get(h, "/api/v1/documents", { headers: { host: "evil.example:80" } })).status).toBe(403);
    expect((await get(h, "/api/v1/documents", { headers: { origin: "https://evil.example" } })).status).toBe(403);
    expect((await get(h, "/api/v1/documents", { headers: { origin: "http://127.0.0.1:4790" } })).status).toBe(200);
  });

  it("will not bind beyond loopback without a token", () => {
    expect(() => assertBindable("0.0.0.0", undefined)).toThrow(/without a token/);
    expect(() => assertBindable("192.168.1.5", undefined)).toThrow();
    expect(() => assertBindable("0.0.0.0", "t")).not.toThrow();
    expect(() => assertBindable("127.0.0.1", undefined)).not.toThrow();
  });

  it("the listener refuses to start in that case", async () => {
    await expect(startListener({ host: "0.0.0.0", port: 0, handler: async () => new Response("") })).rejects.toThrow();
  });
});

describe("the workspace", () => {
  beforeEach(async () => { await stores.updateWorkspace((w) => { w.roots = [roots]; }); });

  it("lists git folders under the roots and marks the others", async () => {
    const h = createHandler({ serviceUrl: service.url, stores });
    const { folders } = await (await get(h, "/api/folders")).json();
    expect(folders.map((f: any) => [f.name, f.git])).toEqual([["game-server", true], ["notes", false]]);
  });

  it("refuses to watch a folder it did not offer", async () => {
    const h = createHandler({ serviceUrl: service.url, stores });
    expect((await post(h, "/api/v1/watch", { path: "/etc" })).status).toBe(403);
    expect((await post(h, "/api/v1/watch", { path: join(roots, "notes") })).status).toBe(403);
    expect(service.seen).toHaveLength(0);
  });

  it("records watch, pause and unwatch in the file only after the service accepts", async () => {
    const h = createHandler({ serviceUrl: service.url, stores });
    const path = join(roots, "game-server");
    expect((await post(h, "/api/v1/watch", { path })).status).toBe(200);
    expect((await stores.workspace.read()).repositories).toEqual([{ path, paused: false }]);
    await post(h, "/api/v1/pause", { repository: "game-server" });
    expect((await stores.workspace.read()).repositories[0]!.paused).toBe(true);
    await post(h, "/api/v1/unwatch", { repository: "game-server" });
    expect((await stores.workspace.read()).repositories).toEqual([]);
  });

  it("does not record a watch the service refused", async () => {
    await service.close();
    service = await fakeService({ "/v1/watch": () => ({ status: 400, body: { name: "MALFORMED-REQUEST", message: "no" } }) });
    const h = createHandler({ serviceUrl: service.url, stores });
    expect((await post(h, "/api/v1/watch", { path: join(roots, "game-server") })).status).toBe(400);
    expect((await stores.workspace.read()).repositories).toEqual([]);
  });

  it("forgets a folder that is gone without calling the service, and only one in the file", async () => {
    const gone = join(roots, "gone");
    await stores.updateWorkspace((w) => { w.repositories = [{ path: gone, paused: false }]; });
    const h = createHandler({ serviceUrl: service.url, stores });
    expect((await post(h, "/api/workspace/forget", { path: "/elsewhere" })).status).toBe(404);
    expect((await post(h, "/api/workspace/forget", { path: gone })).status).toBe(200);
    expect((await stores.workspace.read()).repositories).toEqual([]);
    expect(service.seen).toHaveLength(0);
  });

  it("replays watch and pause at startup and keeps a missing folder", async () => {
    const present = join(roots, "game-server");
    await stores.updateWorkspace((w) => { w.repositories = [{ path: present, paused: true }, { path: join(roots, "gone"), paused: false }]; });
    const report = await restoreWorkspace({ serviceUrl: service.url, stores });
    expect(report.map((r) => r.state)).toEqual(["watched", "missing"]);
    expect(service.seen.map((s) => s.url)).toEqual(["/v1/watch", "/v1/pause"]);
    expect((await stores.workspace.read()).repositories).toHaveLength(2);
  });
});

describe("the files", () => {
  it("writes with directory mode 0700 and file mode 0600, atomically", async () => {
    await stores.updateWorkspace((w) => { w.roots = ["/x"]; });
    expect((await stat(stores.dir)).mode & 0o777).toBe(0o700);
    expect((await stat(join(stores.dir, "web.json"))).mode & 0o777).toBe(0o600);
  });

  it("reads a missing file as empty", async () => {
    expect(await stores.workspace.read()).toEqual({ version: 1, roots: [], repositories: [] });
  });

  it("reports a file that does not parse and never overwrites it", async () => {
    await mkdir(stores.dir, { recursive: true });
    await writeFile(join(stores.dir, "web.json"), "{ not json");
    const h = createHandler({ serviceUrl: service.url, stores });
    expect((await (await get(h, "/api/workspace")).json()).damaged).toBeTruthy();
    await expect(stores.updateWorkspace((w) => { w.roots = ["/x"]; })).rejects.toThrow(/does not parse/);
    expect(await readFile(join(stores.dir, "web.json"), "utf8")).toBe("{ not json");
  });

  it("keeps interface state through a PUT and a GET", async () => {
    const h = createHandler({ serviceUrl: service.url, stores });
    await h(new Request("http://127.0.0.1:4790/api/ui-state", { method: "PUT", headers: { host: "127.0.0.1:4790" }, body: JSON.stringify({ view: "list", recent: ["a/REQ-1"] }) }));
    const state = await (await get(h, "/api/ui-state")).json();
    expect(state).toMatchObject({ view: "list", recent: ["a/REQ-1"] });
  });
});

describe("static files", () => {
  it("serves the build and refuses a path outside it", async () => {
    const dist = await mkdtemp(join(tmpdir(), "synoptik-dist-"));
    await writeFile(join(dist, "index.html"), "<p>ui</p>");
    await writeFile(join(home, "secret.txt"), "private");
    const h = createHandler({ serviceUrl: service.url, stores });
    const server = await startListener({ host: "127.0.0.1", port: 0, handler: h, staticDir: dist });
    const port = (server.address() as any).port;
    expect(await (await fetch(`http://127.0.0.1:${port}/`)).text()).toBe("<p>ui</p>");
    const escape = await fetch(`http://127.0.0.1:${port}/..%2F${home.split("/").pop()}%2Fsecret.txt`);
    expect(escape.status).toBe(404);
    server.close();
    await rm(dist, { recursive: true, force: true });
  });
});
