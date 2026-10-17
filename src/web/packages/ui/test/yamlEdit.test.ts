import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseErrors, readFields, setBlock, setField, setList } from "../src/yamlEdit.js";

// The documents of this tree: the real thing the editor has to hold still.
const docs = join(__dirname, "../../../../../docs");
const files: string[] = [];
(function walk(dir: string) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walk(path);
    else if (/\.ya?ml$/.test(name)) files.push(path);
  }
})(docs);

const changedLines = (a: string, b: string) => {
  const x = a.split("\n"), y = b.split("\n");
  let head = 0;
  while (head < x.length && head < y.length && x[head] === y[head]) head++;
  let tail = 0;
  while (tail < x.length - head && tail < y.length - head && x[x.length - 1 - tail] === y[y.length - 1 - tail]) tail++;
  return { removed: x.length - head - tail, added: y.length - head - tail };
};

describe("over every document in this tree", () => {
  it("has documents to test", () => expect(files.length).toBeGreaterThan(300));

  it("parses each and reads an id", () => {
    for (const file of files) {
      const text = readFileSync(file, "utf8");
      expect(parseErrors(text), file).toEqual([]);
      expect(readFields(text).id, file).not.toBe("");
    }
  });

  it("an edit that sets the value a field already has returns the same text", () => {
    for (const file of files) {
      const text = readFileSync(file, "utf8");
      const f = readFields(text);
      expect(setField(text, "title", f.title), file).toBe(text);
      expect(setList(text, "tags", f.tags), file).toBe(text);
      expect(setList(text, "refines", f.refines), file).toBe(text);
      expect(setBlock(text, "summary", f.summary), file).toBe(text);
    }
  });

  it("a changed title changes only the title's lines and no other field", () => {
    for (const file of files) {
      const text = readFileSync(file, "utf8");
      const before = readFields(text);
      if (!before.title) continue;
      const after = setField(text, "title", before.title + " EDITED");
      const f = readFields(after);
      expect(f.title, file).toBe(before.title + " EDITED");
      expect({ ...f, title: "" }, file).toEqual({ ...before, title: "" });
      expect(parseErrors(after), file).toEqual([]);
      const d = changedLines(text, after);
      const titleLines = (/^title:[^\n]*(\n[ \t]+[^\n]*)*/m.exec(text)?.[0] ?? "").split("\n").length;
      expect(d.removed, file).toBeLessThanOrEqual(titleLines);
    }
  });

  it("a changed summary changes only the summary's lines and no other field", () => {
    for (const file of files) {
      const text = readFileSync(file, "utf8");
      const before = readFields(text);
      if (!before.summary) continue;
      const after = setBlock(text, "summary", before.summary + "\nAn added line.");
      const f = readFields(after);
      expect(f.summary, file).toBe(before.summary + "\nAn added line.");
      expect({ ...f, summary: "" }, file).toEqual({ ...before, summary: "" });
      expect(parseErrors(after), file).toEqual([]);
      expect(changedLines(text, after).removed, file).toBeLessThanOrEqual(before.summary.split("\n").length + 1);
    }
  });

  it("a changed tag list changes only the tags and no other field", () => {
    for (const file of files) {
      const text = readFileSync(file, "utf8");
      const before = readFields(text);
      const after = setList(text, "tags", [...before.tags, "added-tag"]);
      const f = readFields(after);
      expect(f.tags, file).toEqual([...before.tags, "added-tag"]);
      expect({ ...f, tags: [] }, file).toEqual({ ...before, tags: [] });
      expect(parseErrors(after), file).toEqual([]);
    }
  });
});

describe("adding a field the document lacks", () => {
  it("appends it on its own line and parses", () => {
    const after = setField("id: X-1\ntitle: t\n", "priority", "p2");
    expect(after).toBe("id: X-1\ntitle: t\npriority: p2\n");
    expect(readFields(after).priority).toBe("p2");
  });

  it("quotes a title that plain YAML would misread", () => {
    const after = setField("id: X-1\ntitle: t\n", "title", "Users share a board: live");
    expect(readFields(after).title).toBe("Users share a board: live");
  });
});
