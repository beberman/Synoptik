import { describe, expect, it } from "vitest";
import { CloudCliAdapter, NativeAdapter, Unsupported } from "../src/index.js";

describe("the native adapter", () => {
  it("claims nothing and says why", async () => {
    const adapter = new NativeAdapter();
    const c = await adapter.capabilities();
    expect(c.supported).toEqual([]);
    expect(c.notes.list).toMatch(/not which session/);
    await expect(adapter.list()).rejects.toBeInstanceOf(Unsupported);
    await expect(adapter.stop("x")).rejects.toBeInstanceOf(Unsupported);
    expect(() => adapter.subscribe("x", () => {})).toThrow(Unsupported);
  });
});

const projects = [{ displayName: "game-server", fullPath: "/home/u/game-server", sessions: [
  { id: "s1", provider: "claude", summary: "Fix the lobby", lastActivity: "2026-10-17T10:00:00Z", messageCount: 4 },
] }];

describe("the CloudCLI adapter", () => {
  it("lists the sessions of each project with the bearer token", async () => {
    let seen: any;
    const adapter = new CloudCliAdapter({ baseUrl: "http://c:3001/", token: "jwt", fetch: (async (url: string, init: any) => { seen = { url, init }; return new Response(JSON.stringify(projects)); }) as any });
    const sessions = await adapter.list();
    expect(seen.url).toBe("http://c:3001/api/projects");
    expect(seen.init.headers.authorization).toBe("Bearer jwt");
    expect(sessions).toEqual([{ id: "s1", task: "Fix the lobby", repository: "/home/u/game-server", status: "unknown", since: "2026-10-17T10:00:00Z", provider: "claude" }]);
  });

  it("reports only what its configuration allows", async () => {
    expect((await new CloudCliAdapter({ baseUrl: "x" }).capabilities()).supported).toEqual([]);
    expect((await new CloudCliAdapter({ baseUrl: "x", token: "t" }).capabilities()).supported).toEqual(["list"]);
    expect((await new CloudCliAdapter({ baseUrl: "x", token: "t", apiKey: "k" }).capabilities()).supported).toEqual(["list", "launch"]);
  });

  it("never reports a status it was not told", async () => {
    const adapter = new CloudCliAdapter({ baseUrl: "x", token: "t", fetch: (async () => new Response(JSON.stringify(projects))) as any });
    expect((await adapter.list()).every((s) => s.status === "unknown")).toBe(true);
    await expect(adapter.status("s1")).rejects.toBeInstanceOf(Unsupported);
  });

  it("starts a run with the API key and the task", async () => {
    let seen: any;
    const adapter = new CloudCliAdapter({ baseUrl: "http://c", apiKey: "k", fetch: (async (url: string, init: any) => { seen = { url, init }; return new Response(JSON.stringify({ sessionId: "s9" })); }) as any });
    const session = await adapter.launch({ repository: "/r", task: "do it" });
    expect(seen.url).toBe("http://c/api/agent");
    expect(seen.init.headers["x-api-key"]).toBe("k");
    expect(JSON.parse(seen.init.body)).toMatchObject({ projectPath: "/r", message: "do it", provider: "claude", stream: false });
    expect(session.id).toBe("s9");
  });

  it("refuses to list or launch without the credential", async () => {
    const adapter = new CloudCliAdapter({ baseUrl: "x" });
    await expect(adapter.list()).rejects.toBeInstanceOf(Unsupported);
    await expect(adapter.launch({ repository: "r", task: "t" })).rejects.toBeInstanceOf(Unsupported);
  });
});
