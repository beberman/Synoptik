import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";
import {
  addAfter, build, canIndent, canOutdent, indent, joinOutline, moveDown, moveTo, moveUp, outdent, parseOutline, remove, rowsOf, split,
} from "../src/outline.js";
import { parseErrors, readFields, setBlock } from "../src/yamlEdit.js";

const docs = join(__dirname, "../../../../../docs");
const files: string[] = [];
(function walk(dir: string) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walk(path);
    else if (/\.ya?ml$/.test(name)) files.push(path);
  }
})(docs);

const sample = [
  "PRIORITY: P2", "",
  "WHAT IT NEEDS", "",
  "R1  First.", "      continued", "",
  "    a child of R1", "",
  "R2  Second.", "",
  "OTHER", "",
  "plain",
].join("\n").replace("PRIORITY: P2\n\n", "PRIORITY: P2\n\n");

const lines = (o: ReturnType<typeof parseOutline>) => o.texts.map((t) => t.split("\n")[0].trim());

describe("parse and join", () => {
  it("reproduces every summary and body of the tree character for character", () => {
    let checked = 0;
    for (const f of files) {
      let d: any;
      try { d = parse(readFileSync(f, "utf8")); } catch { continue; }
      for (const k of ["summary", "body"]) {
        if (typeof d?.[k] !== "string") continue;
        expect(joinOutline(parseOutline(d[k])), `${f} ${k}`).toBe(d[k]);
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(500);
  });

  it("keeps the blank lines between blocks where they were", () => {
    const text = "A\n\n\n\nB\n  \nC\n\n";
    expect(joinOutline(parseOutline(text))).toBe(text);
  });
});

describe("structure", () => {
  const o = parseOutline(sample);
  const rows = rowsOf(o.texts);

  it("reads headings, labelled items and indented children", () => {
    expect(rows.map((r) => r.kind)).toEqual(["para", "heading", "item", "para", "item", "heading", "para"]);
    expect(rows.map((r) => r.depth)).toEqual([0, 0, 1, 2, 1, 0, 1]);
  });

  it("gives a heading everything to the next heading, and an item its children", () => {
    expect(rows[1].end).toBe(5);
    expect(rows[2].end).toBe(4);
  });
});

describe("editing the structure", () => {
  const base = parseOutline(sample);

  it("indents a block with what belongs to it and outdents it back", () => {
    const o = indent(base, 4); // R2 under R1's children? R1 is a sibling above: R2 becomes R1's child
    expect(rowsOf(o.texts).map((r) => r.depth)).toEqual([0, 0, 1, 2, 2, 0, 1]);
    expect(joinOutline(outdent(o, 4))).toBe(joinOutline(base));
  });

  it("refuses to indent under a heading or into nothing, and to outdent a heading", () => {
    expect(canIndent(base, 2)).toBe(false);
    expect(canIndent(base, 0)).toBe(false);
    expect(canOutdent(base, 1)).toBe(false);
    expect(canOutdent(base, 2)).toBe(false);
    expect(canOutdent(base, 3)).toBe(true);
  });

  it("moves an item with its children past its sibling and leaves the gaps in place", () => {
    const o = moveDown(base, 2);
    expect(lines(o).slice(2, 5)).toEqual(["R2  Second.", "R1  First.", "a child of R1"]);
    expect(o.gaps).toEqual(base.gaps);
    expect(joinOutline(moveUp(o, 3))).toBe(joinOutline(base));
  });

  it("carries a whole section when a heading moves", () => {
    const o = moveDown(base, 1);
    expect(lines(o)).toEqual(["PRIORITY: P2", "OTHER", "plain", "WHAT IT NEEDS", "R1  First.", "a child of R1", "R2  Second."]);
  });

  it("moves the last block of a section into the next section and back", () => {
    const o = moveDown(base, 4);
    expect(lines(o).slice(4)).toEqual(["OTHER", "R2  Second.", "plain"]);
    expect(joinOutline(moveUp(o, 5))).toBe(joinOutline(base));
  });

  it("drops a block before another and takes that block's indentation", () => {
    const o = moveTo(base, 6, 3);
    expect(lines(o).slice(2, 5)).toEqual(["R1  First.", "plain", "a child of R1"]);
    expect(rowsOf(o.texts)[3].indent).toBe(rowsOf(base.texts)[3].indent);
    expect(moveTo(base, 2, 3)).toBe(base);
  });

  it("adds a block after a subtree and removes one with its children", () => {
    const { outline, index } = addAfter(base, 2, "R1a  new");
    expect(index).toBe(4);
    expect(lines(outline).slice(2, 6)).toEqual(["R1  First.", "a child of R1", "R1a  new", "R2  Second."]);
    expect(lines(remove(base, 2))).toEqual(["PRIORITY: P2", "WHAT IT NEEDS", "R2  Second.", "OTHER", "plain"]);
  });

  it("keeps the closing whitespace of the text when the last block is added or removed", () => {
    const o = parseOutline("A\n\nB\n");
    expect(joinOutline(addAfter(o, 1, "C").outline)).toBe("A\n\nB\n\nC\n");
    expect(joinOutline(remove(o, 1))).toBe("A\n");
  });
});

describe("a block's parts", () => {
  it("sets the label and the indentation aside and puts them back unchanged", () => {
    const text = "    R7   Wrapped item\n      with a second line";
    const p = split(text);
    expect(p).toMatchObject({ indent: 4, label: "R7", gap: "   " });
    expect(build(p)).toBe(text);
    expect(build({ ...p, body: "Edited" })).toBe("    R7   Edited");
  });
});

describe("saving an outline whose first block is indented", () => {
  it("writes a literal block the YAML reader gives back whole", () => {
    const src = "id: X-1\ntitle: t\nbody: |\n  one\n";
    const body = "  child first\n\nsecond";
    const out = setBlock(src, "body", body);
    expect(parseErrors(out)).toEqual([]);
    expect(readFields(out).body).toBe(body);
  });
});
