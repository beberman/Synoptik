import { describe, expect, it } from "vitest";
import { tagOptions } from "../src/data.js";
import type { Doc } from "../src/types.js";

const doc = (repo: string, tags: string[]) => ({ repo, id: "X", tags }) as unknown as Doc;
const docs = [doc("a", ["zeta", "beta"]), doc("a", ["beta"]), doc("b", ["alpha"])];

describe("tag choices", () => {
  it("are alphabetical, not by count", () => {
    expect(tagOptions(docs, [], "").map(([t]) => t)).toEqual(["alpha", "beta", "zeta"]);
  });
  it("come from the chosen repositories only", () => {
    expect(tagOptions(docs, ["a"], "")).toEqual([["beta", 2], ["zeta", 1]]);
    expect(tagOptions(docs, ["b"], "")).toEqual([["alpha", 1]]);
  });
  it("keep a chosen tag the repositories do not hold", () => {
    expect(tagOptions(docs, ["b"], "zeta")[0]).toEqual(["zeta", 0]);
  });
});
