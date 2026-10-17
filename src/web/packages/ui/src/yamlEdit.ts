// Edits to a document's YAML that keep every character they were not asked to
// change (DES-0057 D14, D15). The parse supplies positions and the edit
// replaces one node's characters in the original text. The document is never
// re-serialised: that changed 484 of 489 documents in spike S2.
import { isMap, isScalar, parseDocument, type Document, type Node, type Pair } from "yaml";

export interface Fields {
  id: string;
  title: string;
  status: string;
  priority: string;
  severity: string;
  date: string;
  tags: string[];
  refines: string[];
  affects: string[];
  summary: string;
  body: string;
}

const LIST_KEYS = ["tags", "refines", "affects"] as const;
const STRING_KEYS = ["id", "title", "status", "priority", "severity", "date", "summary", "body"] as const;

export function parse(text: string): Document.Parsed {
  return parseDocument(text, { keepSourceTokens: false });
}

function pairFor(doc: Document.Parsed, key: string): Pair<Node, Node> | undefined {
  const map = doc.contents;
  if (!isMap(map)) return undefined;
  return map.items.find((p) => isScalar(p.key) && p.key.value === key) as Pair<Node, Node> | undefined;
}

const asText = (value: unknown) => (value === null || value === undefined ? "" : String(value));

/** The fields the form shows, read from TEXT. A key the document lacks reads as empty. */
export function readFields(text: string): Fields {
  const doc = parse(text);
  const js = (doc.toJS() ?? {}) as Record<string, unknown>;
  const fields: Record<string, unknown> = {};
  for (const key of STRING_KEYS) {
    const value = js[key];
    fields[key] = key === "summary" || key === "body" ? asText(value).replace(/\n+$/, "") : asText(value);
  }
  for (const key of LIST_KEYS) {
    const value = js[key];
    fields[key] = Array.isArray(value) ? value.map(asText) : value ? [asText(value)] : [];
  }
  return fields as unknown as Fields;
}

/** Whether TEXT parses. The editor shows the first error rather than saving it. */
export function parseErrors(text: string): string[] {
  return parse(text).errors.map((e) => e.message);
}

const PLAIN = /^[A-Za-z0-9_][A-Za-z0-9_ ./()@'-]*$/;
const RESERVED = /^(true|false|null|yes|no|on|off|~)$/i;
const NUMBERISH = /^[-+.]?\d[\d_.:eE+-]*$/;

/** A one-line scalar: plain when that reads back as the same string, else double-quoted. */
export function scalar(value: string): string {
  if (PLAIN.test(value) && !RESERVED.test(value) && !NUMBERISH.test(value) && !value.endsWith(" ")) return value;
  return JSON.stringify(value);
}

const flowList = (items: string[]) => `[${items.map(scalar).join(", ")}]`;

/** VALUE as a literal block scalar's lines, indented under a key at column 0. */
function blockScalar(value: string): string {
  const lines = value.replace(/\n+$/, "").split("\n");
  return "|\n" + lines.map((line) => (line ? `  ${line}` : "")).join("\n") + "\n";
}

/** Where, in TEXT, the value of PAIR starts (after `key:` and the space) and where it ends. */
function valueSpan(text: string, pair: Pair<Node, Node>): { start: number; end: number } {
  const keyEnd = pair.key.range![1];
  const colon = text.indexOf(":", keyEnd);
  let start = colon + 1;
  while (text[start] === " " || text[start] === "\t") start++;
  const node = pair.value;
  // A missing value (`key:`) parses to null; its span is empty at the line end.
  if (!node || !node.range) return { start: colon + 1, end: colon + 1 };
  const range = node.range;
  // A block collection starts on the next line, so the span begins at the first
  // character the value occupies, and the newline after the colon is replaced.
  const begin = Math.min(Math.max(start, colon + 1), range[0] < start ? start : range[0]);
  return { start: begin, end: range[1] };
}

function replaceValue(text: string, key: string, rendered: string, block: boolean): string {
  const doc = parse(text);
  const pair = pairFor(doc, key);
  if (!pair) {
    const tail = text.endsWith("\n") || text === "" ? "" : "\n";
    return `${text}${tail}${key}: ${block ? rendered : rendered + "\n"}`;
  }
  const span = valueSpan(text, pair);
  const node = pair.value;
  // A block scalar's range ends after its last line; a plain value's ends before the newline.
  const isBlock = isScalar(node) && (node.type === "BLOCK_LITERAL" || node.type === "BLOCK_FOLDED");
  let end = span.end;
  if (isBlock) {
    // Keep the final newline out of the replaced span unless the new value brings its own.
    while (end > span.start && text[end - 1] === "\n") end--;
    end = Math.min(text.length, end + (text[end] === "\n" ? 1 : 0));
  }
  const replacement = block ? rendered : rendered;
  const before = text.slice(0, span.start);
  const after = text.slice(end);
  return before + replacement + (block && !after.startsWith("\n") && after !== "" && !replacement.endsWith("\n") ? "\n" : "") + after;
}

/** Set a one-line string field. Returns TEXT itself when the value is already that. */
export function setField(text: string, key: string, value: string): string {
  if (readFields(text)[key as keyof Fields] === value) return text;
  return replaceValue(text, key, scalar(value), false);
}

/** Set a list field, written as a one-line flow list. */
export function setList(text: string, key: (typeof LIST_KEYS)[number], items: string[]): string {
  const current = readFields(text)[key];
  if (current.length === items.length && current.every((v, i) => v === items[i])) return text;
  return replaceValue(text, key, flowList(items), false);
}

/** Set a block-scalar field (`summary`, `body`). */
export function setBlock(text: string, key: "summary" | "body", value: string): string {
  if (readFields(text)[key] === value.replace(/\n+$/, "")) return text;
  return replaceValue(text, key, blockScalar(value), true);
}
