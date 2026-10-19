// Runs the client against a live Synoptik service (SYNOPTIK_URL, default
// http://127.0.0.1:4780) and is skipped when none answers. It only reads, and
// saves a document unchanged, so it leaves the tree as it found it.
import { describe, expect, it } from "vitest";
import { ApiError, fetchClient, operations } from "../src/index.js";

const base = process.env.SYNOPTIK_URL ?? "http://127.0.0.1:4780";
const up = await fetch(`${base}/v1/status`).then((r) => r.ok, () => false);

// The service is reached directly, so the client's `/api/v1/` prefix is mapped to `/v1/`.
const direct = fetchClient({ fetch: ((url: string, init: any) => fetch(url.replace(`${""}/api/v1/`, `${base}/v1/`), init)) as any });

describe.skipIf(!up)("the client against a running service", () => {
  const ops = operations(direct);

  it("lists documents with the fields the explorer filters on", async () => {
    const [first] = await ops.documents();
    expect(first!.documents.length).toBeGreaterThan(0);
    const row = first!.documents[0]!;
    for (const key of ["id", "title", "status", "tags", "refines", "affects", "path", "category"]) expect(row).toHaveProperty(key);
  });

  it("reads a document and saves it unchanged without writing", async () => {
    const [first] = await ops.documents();
    const id = first!.documents.find((d) => d.path)!.id;
    const read = await ops.readDocument(first!.repository, id);
    expect(read.text.length).toBeGreaterThan(0);
    const saved = await ops.writeDocument(first!.repository, id, read.text, read.version);
    expect(saved.changed).toBe(false);
    expect(saved.version).toBe(read.version);
  });

  it("refuses to create a design, naming what is allowed", async () => {
    const [first] = await ops.documents();
    const error = await direct("POST", "/api/v1/create-document", { repository: first!.repository, category: "design", title: "x" }).catch((e) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect(error.message).toMatch(/req and bug/);
  });
});
