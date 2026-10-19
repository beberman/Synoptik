// A line diff, for showing what changed in a document. Display only: nothing
// here writes text, and a document is never rebuilt from a diff.

export type DiffLine = { kind: "same" | "add" | "del"; text: string };
export type Shown = DiffLine | { kind: "skip"; count: number };

const LIMIT = 4_000_000;

export function lineDiff(before: string, after: string): DiffLine[] {
  const a = before.split("\n"), b = after.split("\n");
  let head = 0;
  while (head < a.length && head < b.length && a[head] === b[head]) head++;
  let tail = 0;
  while (tail < a.length - head && tail < b.length - head && a[a.length - 1 - tail] === b[b.length - 1 - tail]) tail++;
  const x = a.slice(head, a.length - tail), y = b.slice(head, b.length - tail);
  const out: DiffLine[] = a.slice(0, head).map((text) => ({ kind: "same", text }));
  if (x.length * y.length > LIMIT) {
    // Too large to align: say that all of the middle changed rather than guess.
    x.forEach((text) => out.push({ kind: "del", text }));
    y.forEach((text) => out.push({ kind: "add", text }));
  } else {
    const n = x.length, m = y.length;
    const table: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
    for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--)
      table[i][j] = x[i] === y[j] ? table[i + 1][j + 1] + 1 : Math.max(table[i + 1][j], table[i][j + 1]);
    let i = 0, j = 0;
    while (i < n && j < m) {
      if (x[i] === y[j]) { out.push({ kind: "same", text: x[i] }); i++; j++; }
      else if (table[i + 1][j] >= table[i][j + 1]) out.push({ kind: "del", text: x[i++] });
      else out.push({ kind: "add", text: y[j++] });
    }
    while (i < n) out.push({ kind: "del", text: x[i++] });
    while (j < m) out.push({ kind: "add", text: y[j++] });
  }
  a.slice(a.length - tail).forEach((text) => out.push({ kind: "same", text }));
  return out;
}

/** The changed lines with CONTEXT unchanged lines either side; the rest become a count. */
export function withContext(lines: DiffLine[], context = 2): Shown[] {
  const keep = new Array<boolean>(lines.length).fill(false);
  lines.forEach((l, i) => {
    if (l.kind === "same") return;
    for (let k = Math.max(0, i - context); k <= Math.min(lines.length - 1, i + context); k++) keep[k] = true;
  });
  const out: Shown[] = [];
  let skipped = 0;
  lines.forEach((l, i) => {
    if (keep[i]) { if (skipped) { out.push({ kind: "skip", count: skipped }); skipped = 0; } out.push(l); }
    else skipped++;
  });
  if (skipped) out.push({ kind: "skip", count: skipped });
  return out;
}
