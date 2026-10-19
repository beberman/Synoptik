// The outline a summary or body is drawn as (DES-0057 D15).
//
// A body is blocks of text divided by blank lines. Three things give it shape:
// an all-capitals line is a heading and owns the blocks up to the next heading;
// a block indented deeper than the one before it belongs to that block; and a
// block beginning `R12`, `D3`, `S2a` carries a label. Nothing here is saved
// as structure. The outline is rebuilt from the text each time, and every edit
// here is an edit of the text: the characters between blocks stay where they
// were, so a block nobody touched keeps its bytes.

export const STEP = 2;

export interface Outline {
  /** Blank lines before the first block. */
  lead: string;
  /** Each block's text, with its own indentation and no trailing whitespace. */
  texts: string[];
  /** What follows each block up to the next one. Positional: a block that moves leaves its gap behind. */
  gaps: string[];
}

export type Kind = "heading" | "item" | "para";

export interface Row {
  kind: Kind;
  /** Spaces before the block's least-indented line. */
  indent: number;
  /** 0 for a heading, then one more for each enclosing indent under it. */
  depth: number;
  /** One past the last row that belongs to this one. */
  end: number;
}

const HEADING = /^[A-Z][A-Z0-9 ,&'/()\-]{3,}$/;
const LABEL = /^([A-Z]{1,4}\d+[a-z]?)([ \t]+)/;

export function parseOutline(text: string): Outline {
  const lead = /^(?:[ \t]*\n)*/.exec(text)![0];
  const rest = text.slice(lead.length);
  const texts: string[] = [];
  const gaps: string[] = [];
  const parts = rest.split(/(\n{2,})/);
  for (let i = 0; i < parts.length; i += 2) {
    const piece = parts[i];
    const sep = parts[i + 1] ?? "";
    const body = piece.replace(/\s+$/, "");
    if (body === "") {
      // Whitespace between two separators, or after the last: it belongs to the gap before it.
      if (gaps.length) gaps[gaps.length - 1] += piece + sep;
      else if (piece + sep) return { lead: lead + piece + sep, texts: [], gaps: [] };
      continue;
    }
    texts.push(body);
    gaps.push(piece.slice(body.length) + sep);
  }
  return { lead, texts, gaps };
}

export function joinOutline(o: Outline): string {
  return o.lead + o.texts.map((t, i) => t + o.gaps[i]).join("");
}

export const indentOf = (text: string): number => {
  let least = Infinity;
  for (const line of text.split("\n")) if (line.trim()) least = Math.min(least, line.length - line.trimStart().length);
  // A block with nothing in it yet keeps the place it was added at.
  return least === Infinity ? (text.trim() === "" ? text.length : 0) : least;
};

export function kindOf(text: string): Kind {
  if (!text.includes("\n") && indentOf(text) === 0 && HEADING.test(text)) return "heading";
  if (LABEL.test(text.trimStart())) return "item";
  return "para";
}

export function rowsOf(texts: string[]): Row[] {
  const rows: Row[] = [];
  let stack: number[] = [];
  let base = 0;
  texts.forEach((t) => {
    const kind = kindOf(t);
    const indent = indentOf(t);
    if (kind === "heading") {
      stack = [];
      base = 1;
      rows.push({ kind, indent, depth: 0, end: 0 });
      return;
    }
    while (stack.length && stack[stack.length - 1] >= indent) stack.pop();
    rows.push({ kind, indent, depth: base + stack.length, end: 0 });
    stack.push(indent);
  });
  rows.forEach((r, i) => {
    let j = i + 1;
    while (j < rows.length && rows[j].depth > r.depth) j++;
    r.end = j;
  });
  return rows;
}

/** TEXT with every non-blank line moved right by BY spaces, or left by -BY, never past column 0. */
export function shift(text: string, by: number): string {
  return text.split("\n").map((line) => {
    if (!line.trim()) return line;
    if (by >= 0) return " ".repeat(by) + line;
    return line.slice(Math.min(-by, line.length - line.trimStart().length));
  }).join("\n");
}

function mapRange(o: Outline, from: number, to: number, f: (t: string) => string): Outline {
  return { ...o, texts: o.texts.map((t, i) => (i >= from && i < to ? f(t) : t)) };
}

export function canIndent(o: Outline, i: number): boolean {
  const rows = rowsOf(o.texts);
  return i > 0 && rows[i].kind !== "heading" && rows[i - 1].depth >= rows[i].depth;
}

export function canOutdent(o: Outline, i: number): boolean {
  const rows = rowsOf(o.texts);
  return rows[i].kind !== "heading" && rows[i].indent > 0;
}

/** Move block I and what belongs to it one step right. */
export function indent(o: Outline, i: number): Outline {
  if (!canIndent(o, i)) return o;
  const rows = rowsOf(o.texts);
  return mapRange(o, i, rows[i].end, (t) => shift(t, STEP));
}

/** Move block I and what belongs to it one step left. */
export function outdent(o: Outline, i: number): Outline {
  if (!canOutdent(o, i)) return o;
  const rows = rowsOf(o.texts);
  const by = Math.min(STEP, rows[i].indent);
  return mapRange(o, i, rows[i].end, (t) => shift(t, -by));
}

/** The index a block and its subtree go to when moved before row TARGET (or the end, TARGET = length). */
function relocate(o: Outline, from: number, to: number, before: number): Outline {
  const moved = o.texts.slice(from, to);
  const without = [...o.texts.slice(0, from), ...o.texts.slice(to)];
  const at = before > from ? before - (to - from) : before;
  without.splice(at, 0, ...moved);
  return { ...o, texts: without };
}

/** Where block I goes moving up one place: before its previous sibling, or out above its heading. */
function upTarget(rows: Row[], i: number): number | null {
  let j = i - 1;
  while (j >= 0 && rows[j].depth > rows[i].depth) j--;
  if (j < 0) return null;
  if (rows[j].depth === rows[i].depth) return j;
  return rows[j].kind === "heading" ? j : null;
}

export function moveUp(o: Outline, i: number): Outline {
  const rows = rowsOf(o.texts);
  const row = rows[i];
  if (row.kind === "heading") {
    let j = i - 1;
    while (j >= 0 && rows[j].kind !== "heading") j--;
    return j < 0 ? o : relocate(o, i, row.end, j);
  }
  const target = upTarget(rows, i);
  return target === null ? o : relocate(o, i, row.end, target);
}

export function moveDown(o: Outline, i: number): Outline {
  const rows = rowsOf(o.texts);
  const row = rows[i];
  if (row.end >= rows.length) return o;
  const next = rows[row.end];
  if (row.kind === "heading") return next.kind === "heading" ? relocate(o, i, row.end, next.end) : o;
  if (next.depth === row.depth) return relocate(o, i, row.end, next.end);
  // The next row is shallower: this was the last child of its parent. A block last in a section
  // steps into the next one, below its heading.
  if (next.kind === "heading") return relocate(o, i, row.end, row.end + 1);
  return o;
}

/** Drop block I and its subtree before row BEFORE, giving its root that row's indentation. */
export function moveTo(o: Outline, i: number, before: number): Outline {
  const rows = rowsOf(o.texts);
  const row = rows[i];
  if (before >= i && before <= row.end) return o;
  if (row.kind === "heading" && before < o.texts.length && rows[before].kind !== "heading") return o;
  const place = before < o.texts.length ? rows[before] : null;
  const target = place && place.kind !== "heading" ? place.indent : 0;
  const shifted = row.kind === "heading" ? o : mapRange(o, i, row.end, (t) => shift(t, target - row.indent));
  return relocate(shifted, i, row.end, before);
}

/** A new empty-looking block after I's subtree at I's indentation. */
export function addAfter(o: Outline, i: number, text = "", pad?: number): { outline: Outline; index: number } {
  const rows = rowsOf(o.texts);
  const at = rows[i].end;
  pad ??= rows[i].kind === "heading" ? 0 : rows[i].indent;
  const texts = [...o.texts];
  const gaps = [...o.gaps];
  texts.splice(at, 0, " ".repeat(pad) + text);
  // The gap that closed the block stays where it was; the new block gets an ordinary one.
  if (at === o.texts.length) {
    gaps.splice(at - 1, 0, "\n\n");
  } else {
    gaps.splice(at, 0, "\n\n");
  }
  return { outline: { ...o, texts, gaps }, index: at };
}

export function remove(o: Outline, i: number): Outline {
  const rows = rowsOf(o.texts);
  const to = rows[i].end;
  const texts = o.texts.filter((_, k) => k < i || k >= to);
  const gaps = o.gaps.filter((_, k) => k < i || k >= to);
  // Taking the last block takes its closing gap; the one before inherits it.
  if (to === o.texts.length && i > 0) gaps[gaps.length - 1] = o.gaps[o.gaps.length - 1];
  return { ...o, texts, gaps };
}

/** What a block shows in its text box: its label and indentation set aside. */
export interface Parts { indent: number; label: string; gap: string; body: string }

export function split(text: string): Parts {
  if (text.trim() === "") return { indent: text.length, label: "", gap: "", body: "" };
  const indent = indentOf(text);
  const plain = shift(text, -indent);
  const m = LABEL.exec(plain);
  if (!m) return { indent, label: "", gap: "", body: plain };
  return { indent, label: m[1], gap: m[2], body: plain.slice(m[0].length) };
}

export function build(p: Parts): string {
  if (p.label + p.body === "") return " ".repeat(p.indent);
  return shift(p.label + p.gap + p.body, p.indent);
}

/** The outline without blocks that hold nothing, which are only a place to type into. */
export function compact(o: Outline): Outline {
  const keep = o.texts.map((t) => t.trim() !== "");
  if (keep.every(Boolean)) return o;
  const texts: string[] = [];
  const gaps: string[] = [];
  o.texts.forEach((t, i) => { if (keep[i]) { texts.push(t); gaps.push(o.gaps[i]); } });
  // The text's closing whitespace stays at its end.
  if (gaps.length) gaps[gaps.length - 1] = o.gaps[o.gaps.length - 1];
  return { ...o, texts, gaps };
}
