import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { HostAdapter, Unsupported, type Status } from "../../agents/src/index.js";
import { ClaudeRunner, createHostHandler, listen } from "../src/index.js";

const fake = fileURLToPath(new URL("./fake-claude.mjs", import.meta.url));
const TOKEN = "adapter-token";
const cleanup: (() => unknown)[] = [];
afterEach(async () => { for (const c of cleanup.splice(0)) await c(); });

async function host() {
  const dir = mkdtempSync(join(tmpdir(), "adapter-repo-"));
  mkdirSync(join(dir, ".git"));
  cleanup.push(() => rmSync(dir, { recursive: true, force: true }));
  const server = await listen("127.0.0.1", 0, createHostHandler({
    token: TOKEN, repositories: [dir], runner: new ClaudeRunner({ command: process.execPath, prefixArgs: [fake], killAfter: 1 }),
  }));
  cleanup.push(() => new Promise<void>((r) => server.close(() => r())));
  return { dir, url: `http://127.0.0.1:${(server.address() as any).port}` };
}
const until = async (ok: () => boolean) => { const end = Date.now() + 5000; while (!ok() && Date.now() < end) await new Promise((r) => setTimeout(r, 20)); if (!ok()) throw new Error("timed out"); };

describe("HostAdapter against the agent host", () => {
  it("offers what the host offers, and says what it lacks", async () => {
    const { url } = await host();
    const adapter = new HostAdapter({ baseUrl: url, token: TOKEN });
    const capabilities = await adapter.capabilities();
    expect(capabilities.supported).toEqual(["list", "launch", "stop", "status", "subscribe"]);
    expect(capabilities.notes.approve).toBeTruthy();
    await expect(adapter.approve("x", "y", true)).rejects.toBeInstanceOf(Unsupported);
  });

  it("launches, lists, reports status and follows a session to its end", async () => {
    const { dir, url } = await host();
    const adapter = new HostAdapter({ baseUrl: url, token: TOKEN });
    const session = await adapter.launch({ repository: dir, task: "fix the reference" });
    expect(session.status).toBe("working");
    const seen: Status[] = [];
    const stop = adapter.subscribe(session.id, (s) => seen.push(s));
    await until(() => seen.includes("finished"));
    stop();
    expect(seen[0]).toBe("working");
    expect(await adapter.status(session.id)).toBe("finished");
    expect((await adapter.list()).map((s) => s.id)).toContain(session.id);
  });

  it("stops a run", async () => {
    const { dir, url } = await host();
    const adapter = new HostAdapter({ baseUrl: url, token: TOKEN });
    const session = await adapter.launch({ repository: dir, task: "hang" });
    await adapter.stop(session.id);
    await until(() => true);
    for (let i = 0; i < 100 && (await adapter.status(session.id)) === "working"; i++) await new Promise((r) => setTimeout(r, 30));
    expect(await adapter.status(session.id)).toBe("idle");
  });

  it("carries the host's refusals as errors in its words", async () => {
    const { url } = await host();
    const adapter = new HostAdapter({ baseUrl: url, token: TOKEN });
    await expect(adapter.launch({ repository: "/etc", task: "x" })).rejects.toThrow(/not one this host runs agents in/);
    const wrong = new HostAdapter({ baseUrl: url, token: "nope" });
    await expect(wrong.list()).rejects.toThrow(/bearer token/);
  });

  it("reports an unreachable host as offering nothing, with the reason", async () => {
    const adapter = new HostAdapter({ baseUrl: "http://127.0.0.1:9", token: TOKEN });
    const capabilities = await adapter.capabilities();
    expect(capabilities.supported).toEqual([]);
    expect(capabilities.notes.launch).toMatch(/did not answer/);
  });
});
