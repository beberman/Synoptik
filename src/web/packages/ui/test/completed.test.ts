import { describe, expect, it } from "vitest";
import { isCompleted, matches } from "../src/data.js";
import { EMPTY } from "../src/components/Sidebar.js";
import type { Doc } from "../src/types.js";

const doc = (path: string) => ({ repo: "r", id: "REQ-0001", type: "REQ", title: "t", status: "", priority: "", tags: [], path }) as unknown as Doc;

describe("completed documents", () => {
  it("are those filed under a completed directory, at any depth", () => {
    expect(isCompleted(doc("docs/requirements/completed/REQ-0008.yaml"))).toBe(true);
    expect(isCompleted(doc("completed/x.yaml"))).toBe(true);
    expect(isCompleted(doc("docs/requirements/REQ-0008.yaml"))).toBe(false);
    expect(isCompleted(doc("docs/uncompleted/x.yaml"))).toBe(false);
  });
  it("are left out only when asked", () => {
    const done = doc("docs/bugs/completed/BUG-1.yaml");
    expect(matches(done, EMPTY)).toBe(true);
    expect(matches(done, { ...EMPTY, hideCompleted: true })).toBe(false);
    expect(matches(doc("docs/bugs/BUG-2.yaml"), { ...EMPTY, hideCompleted: true })).toBe(true);
  });
});
