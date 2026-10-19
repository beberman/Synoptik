import { afterEach, describe, expect, it } from "vitest";
import { ChangeFeed, type ChangeEvent } from "../src/changes.js";
import { fakeService } from "./fake-service.js";

const until = async (ok: () => boolean, ms = 3000) => {
  const end = Date.now() + ms;
  while (!ok() && Date.now() < end) await new Promise((r) => setTimeout(r, 10));
  if (!ok()) throw new Error("timed out");
};

let closers: (() => unknown)[] = [];
afterEach(async () => { for (const c of closers) await c(); closers = []; });

describe("ChangeFeed", () => {
  it("starts from the present, then reports each change the service names", async () => {
    let calls = 0;
    const service = await fakeService({
      "/v1/changes": (r) => {
        calls++;
        const after = new URL(r.url, "http://x").searchParams.get("after");
        if (after === null) return { body: { epoch: 7, sequence: 10, reset: true, changes: [] } };
        if (after === "10") return { body: { epoch: 7, sequence: 12, reset: false, changes: [
          { sequence: 11, repository: "front-end", address: "docs/a.yaml", kind: "changed" },
          { sequence: 12, repository: "front-end", address: "docs/b.yaml", kind: "removed" }] } };
        return { body: { epoch: 7, sequence: 12, reset: false, changes: [] } };
      },
    });
    closers.push(service.close);
    const feed = new ChangeFeed({ serviceUrl: service.url, idleMs: 20 });
    const seen: ChangeEvent[] = [];
    closers.push(feed.subscribe((e) => seen.push(e)));
    await until(() => seen.length >= 2);
    expect(seen).toEqual([
      { type: "document", repository: "front-end", address: "docs/a.yaml", kind: "changed", sequence: 11 },
      { type: "document", repository: "front-end", address: "docs/b.yaml", kind: "removed", sequence: 12 },
    ]);
    expect(service.seen[0].url).toContain("wait=20");
    expect(service.seen[0].url).not.toContain("after=");
    expect(service.seen[1].url).toContain("after=10");
    expect(service.seen[1].url).toContain("epoch=7");
    expect(calls).toBeGreaterThan(1);
  });

  it("tells listeners to read everything again when the service says reset", async () => {
    let n = 0;
    const service = await fakeService({
      "/v1/changes": () => (++n === 1
        ? { body: { epoch: 1, sequence: 5, reset: true, changes: [] } }
        : n === 2 ? { body: { epoch: 2, sequence: 1, reset: true, changes: [] } }
          : { body: { epoch: 2, sequence: 1, reset: false, changes: [] } }),
    });
    closers.push(service.close);
    const feed = new ChangeFeed({ serviceUrl: service.url, idleMs: 20 });
    const seen: ChangeEvent[] = [];
    closers.push(feed.subscribe((e) => seen.push(e)));
    await until(() => seen.length >= 1);
    expect(seen[0]).toEqual({ type: "reset", sequence: 1 });
  });

  it("keeps trying while the service is down and stops asking when the last listener goes", async () => {
    let fail = true;
    const service = await fakeService({
      "/v1/changes": () => (fail ? { status: 503, body: { message: "starting" } } : { body: { epoch: 1, sequence: 0, reset: true, changes: [] } }),
    });
    closers.push(service.close);
    const feed = new ChangeFeed({ serviceUrl: service.url, retryMs: 20, idleMs: 20 });
    const stop = feed.subscribe(() => {});
    await until(() => service.seen.length >= 3);
    fail = false;
    await until(() => service.seen.length >= 5);
    stop();
    await new Promise((r) => setTimeout(r, 100));
    const count = service.seen.length;
    await new Promise((r) => setTimeout(r, 150));
    expect(service.seen.length).toBe(count);
  });
});
