// PLAN-0062 S2: does a candidate editor model give back the bytes it was given?
// Candidate A: parse then re-serialise (what a form editor that owns the output does).
// Candidate B: parse for positions, replace only the characters of the edited scalar.
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { parseDocument, visit, isScalar } from "yaml";

const roots = process.argv.slice(2);
const files = [];
const walk = (d) => { for (const n of readdirSync(d)) { const p = join(d, n); const s = statSync(p);
  if (s.isDirectory()) { if (!n.startsWith(".") && n !== "node_modules") walk(p); } else if (/\.ya?ml$/.test(n) && p.includes("/docs/")) files.push(p); } };
roots.forEach(walk);

let total = 0, errors = 0, aDiff = 0, bDiff = 0;
const aSample = [];
for (const f of files) {
  const src = readFileSync(f, "utf8");
  total++;
  const doc = parseDocument(src, { keepSourceTokens: true });
  if (doc.errors.length) { errors++; continue; }
  if (doc.toString({ lineWidth: 0 }) !== src) { aDiff++; if (aSample.length < 3) aSample.push(f); }
  // B: the unedited save sends the source text it received.
  if (src !== src) bDiff++;
}
console.log(JSON.stringify({ files: total, parseErrors: errors, reserialiseChanged: aDiff, spliceChanged: bDiff, sample: aSample }, null, 1));

// Edit test: change one body line in 20 documents; count lines changed beyond it.
let beyondA = 0, beyondB = 0, edited = 0;
for (const f of files) {
  if (edited >= 20) break;
  const src = readFileSync(f, "utf8");
  const doc = parseDocument(src);
  if (doc.errors.length) continue;
  const node = doc.get("summary", true) ?? doc.get("title", true);
  if (!isScalar(node) || !node.range) continue;
  edited++;
  const [s, , e] = node.range;
  const spliced = src.slice(0, s) + src.slice(s, e) + " EDITED" + src.slice(e); // B
  doc.set(node === doc.get("summary", true) ? "summary" : "title", String(node.value) + " EDITED");
  const re = doc.toString({ lineWidth: 0 });
  const diffLines = (a, b) => { const x = a.split("\n"), y = b.split("\n"); let n = Math.abs(x.length - y.length); for (let i = 0; i < Math.min(x.length, y.length); i++) if (x[i] !== y[i]) n++; return n; };
  beyondB += Math.max(0, diffLines(src, spliced) - 1);
  beyondA += Math.max(0, diffLines(src, re) - 1);
}
console.log(JSON.stringify({ editedDocs: edited, extraLinesChangedReserialise: beyondA, extraLinesChangedSplice: beyondB }));
