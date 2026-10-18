import { describe, expect, it } from "vitest";
import { lineDiff, withContext } from "../src/diff.js";

describe("line diff", () => {
  it("reports an edit as one removed and one added line", () => {
    const d = lineDiff("a\nb\nc", "a\nB\nc");
    expect(d.filter((l) => l.kind !== "same")).toEqual([{ kind: "del", text: "b" }, { kind: "add", text: "B" }]);
  });
  it("is empty of changes for equal text and reproduces both sides otherwise", () => {
    expect(lineDiff("x\ny", "x\ny").every((l) => l.kind === "same")).toBe(true);
    const before = "1\n2\n3\n4\n5", after = "1\n3\n4\n4b\n5\n6";
    const d = lineDiff(before, after);
    expect(d.filter((l) => l.kind !== "add").map((l) => l.text).join("\n")).toBe(before);
    expect(d.filter((l) => l.kind !== "del").map((l) => l.text).join("\n")).toBe(after);
  });
  it("folds unchanged stretches away from a change", () => {
    const lines = Array.from({ length: 30 }, (_, i) => `l${i}`);
    const changed = [...lines]; changed[15] = "changed";
    const shown = withContext(lineDiff(lines.join("\n"), changed.join("\n")), 2);
    expect(shown.filter((s) => s.kind === "skip")).toEqual([{ kind: "skip", count: 13 }, { kind: "skip", count: 12 }]);
  });
});
