import { describe, expect, it } from "vitest";
import { ApiError, ConflictError, fetchClient, operations } from "../src/index.js";

const reply = (status: number, body: unknown) => async () => new Response(JSON.stringify(body), { status });

describe("the fetch client", () => {
  it("returns the JSON of a success and sends the bearer token", async () => {
    let seen: Headers | undefined;
    const client = fetchClient({ token: "t", fetch: (async (_u: any, init: any) => { seen = new Headers(init.headers); return new Response('{"a":1}'); }) as any });
    expect(await client("GET", "/api/v1/status")).toEqual({ a: 1 });
    expect(seen!.get("authorization")).toBe("Bearer t");
  });

  it("turns a 409 into a ConflictError carrying the stored text", async () => {
    const client = fetchClient({ fetch: reply(409, { name: "VERSION-CONFLICT", message: "changed", current: { text: "stored", version: "9" } }) as any });
    const error = await client("POST", "/api/v1/write-document", {}).catch((e) => e);
    expect(error).toBeInstanceOf(ConflictError);
    expect(error.current).toEqual({ text: "stored", version: "9" });
  });

  it("turns any other failure into an ApiError with the service's message", async () => {
    const client = fetchClient({ fetch: reply(400, { name: "MALFORMED-REQUEST", message: "Only req and bug can." }) as any });
    const error = await client("POST", "/api/v1/create-document", {}).catch((e) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).not.toBeInstanceOf(ConflictError);
    expect(error.message).toBe("Only req and bug can.");
  });

  it("documents() answers one list per repository whether the service sent one or many", async () => {
    const one = operations(fetchClient({ fetch: reply(200, { repository: "a", documents: [] }) as any }));
    expect(await one.documents("a")).toHaveLength(1);
    const many = operations(fetchClient({ fetch: reply(200, { repositories: [{ repository: "a", documents: [] }, { repository: "b", documents: [] }] }) as any }));
    expect(await many.documents()).toHaveLength(2);
  });
});
