import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowDown, ArrowUp, ChevronDown, ChevronRight, GripVertical, Indent, Outdent, Plus, Trash2 } from "lucide-react";
import Auto from "./Auto";
import {
  addAfter, build, canIndent, canOutdent, compact, indent, joinOutline, moveDown, moveTo, moveUp, outdent, parseOutline, remove, rowsOf, split,
  type Outline as Model,
} from "../outline";

const STEP_PX = 20;

/**
 * A summary or body as an outline: headings that fold, items and paragraphs
 * under them, indentation for children. Every change is an edit of the text
 * and goes out through onChange as text (see ../outline.ts).
 */
export default function Outline({ text, onChange }: { text: string; onChange: (t: string) => void }) {
  const [o, setO] = useState<Model>(() => parseOutline(text));
  const emitted = useRef(text);
  const [folded, setFolded] = useState<Set<number>>(new Set());
  const [dragging, setDragging] = useState<number | null>(null);
  const [over, setOver] = useState<{ index: number; after: boolean } | null>(null);
  const inputs = useRef<(HTMLTextAreaElement | null)[]>([]);
  const focusNext = useRef<number | null>(null);

  // The text changes under us on undo and in the YAML view; our own edits come back unchanged.
  useEffect(() => {
    if (text !== emitted.current) { emitted.current = text; setO(parseOutline(text)); setFolded(new Set()); }
  }, [text]);
  useEffect(() => {
    if (focusNext.current !== null) { inputs.current[focusNext.current]?.focus(); focusNext.current = null; }
  });

  const rows = useMemo(() => rowsOf(o.texts), [o]);

  const commit = (next: Model, focus?: number) => {
    setO(next);
    const t = joinOutline(compact(next));
    emitted.current = t;
    if (focus !== undefined) focusNext.current = focus;
    onChange(t);
  };
  // After a block moves, find it again: the nearest block with its text.
  const follow = (next: Model, i: number) => {
    const t = o.texts[i];
    let best = i, gap = Infinity;
    next.texts.forEach((x, k) => { if (x.trim() === t.trim() && Math.abs(k - i) < gap) { best = k; gap = Math.abs(k - i); } });
    return best;
  };
  const structural = (next: Model, i: number) => { if (next === o) return; setFolded(new Set()); commit(next, follow(next, i)); };

  const edit = (i: number, f: (p: ReturnType<typeof split>) => ReturnType<typeof split>) => {
    const texts = [...o.texts];
    texts[i] = build(f(split(o.texts[i])));
    commit({ ...o, texts });
  };

  const keys = (i: number) => (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.nativeEvent.isComposing) return;
    if (e.key === "Tab") { e.preventDefault(); structural(e.shiftKey ? outdent(o, i) : indent(o, i), i); }
    else if (e.altKey && e.key === "ArrowUp") { e.preventDefault(); structural(moveUp(o, i), i); }
    else if (e.altKey && e.key === "ArrowDown") { e.preventDefault(); structural(moveDown(o, i), i); }
    else if (e.key === "Enter" && !e.shiftKey && !e.altKey) { e.preventDefault(); const a = addAfter(o, i); setFolded(new Set()); commit(a.outline, a.index); }
    else if (e.key === "Backspace" && o.texts[i].trim() === "" && o.texts.length > 1) {
      e.preventDefault(); setFolded(new Set()); commit(remove(o, i), Math.max(0, i - 1));
    }
  };

  const append = (text: string, pad?: number) => {
    if (!o.texts.length) { commit({ ...o, texts: [text], gaps: ["\n"] }, 0); return; }
    const a = addAfter(o, o.texts.length - 1, text, pad);
    commit(a.outline, a.index);
  };

  const out: React.ReactNode[] = [];
  for (let i = 0; i < o.texts.length; i++) {
    const row = rows[i];
    const parts = split(o.texts[i]);
    const hasKids = row.end > i + 1;
    const isFolded = folded.has(i) && hasKids;
    const here = i;
    const up = moveUp(o, here) !== o, down = moveDown(o, here) !== o;
    out.push(
      <div key={i} className={`group relative rounded-lg ${dragging === i ? "opacity-40" : ""}`}
        style={{ paddingLeft: Math.min(row.depth, 8) * STEP_PX }}
        onDragOver={(e) => {
          if (dragging === null) return;
          e.preventDefault();
          const r = e.currentTarget.getBoundingClientRect();
          setOver({ index: here, after: e.clientY > r.top + r.height / 2 });
        }}
        onDrop={(e) => {
          e.preventDefault();
          if (dragging !== null && over) structural(moveTo(o, dragging, over.after ? rows[over.index].end : over.index), dragging);
          setDragging(null); setOver(null);
        }}>
        {over?.index === here && dragging !== null && <div className={`pointer-events-none absolute inset-x-0 h-0.5 bg-accent ${over.after ? "bottom-0" : "top-0"}`} />}
        <div className="flex items-start gap-1">
          <span draggable className="mt-1.5 hidden cursor-grab touch-none text-mute md:block" title="Drag to move"
            onDragStart={(e) => { setDragging(here); e.dataTransfer.effectAllowed = "move"; e.dataTransfer.setData("text/plain", String(here)); }}
            onDragEnd={() => { setDragging(null); setOver(null); }}><GripVertical size={16} /></span>
          <button className={`mt-0.5 flex h-8 w-6 shrink-0 items-center justify-center text-mute md:h-6 ${hasKids ? "" : "invisible"}`}
            aria-label={isFolded ? "Unfold" : "Fold"} onClick={() => setFolded((f) => { const n = new Set(f); if (n.has(here)) n.delete(here); else n.add(here); return n; })}>
            {isFolded ? <ChevronRight size={16} /> : <ChevronDown size={16} />}
          </button>
          <div className="flex min-w-0 flex-1 gap-2">
            {parts.label && <span className="mt-1.5 h-fit shrink-0 rounded bg-accent/15 px-1.5 font-mono text-xs font-semibold text-accent">{parts.label}</span>}
            <Auto value={parts.body} inputRef={(el) => { inputs.current[here] = el; }} onKeyDown={keys(here)}
              onChange={(t) => edit(here, (p) => ({ ...p, body: t.replace(/\n[ \t]*\n+/g, "\n") }))}
              className={row.kind === "heading" ? "text-xs font-bold uppercase tracking-wider text-mute" : "text-sm leading-relaxed"} />
            {isFolded && <span className="mt-2 shrink-0 text-xs text-mute">{row.end - i - 1} hidden</span>}
          </div>
        </div>
        <div className="mb-1 hidden flex-wrap gap-1 pl-7 group-focus-within:flex">
          <button className="btn" disabled={!canOutdent(o, here)} onClick={() => structural(outdent(o, here), here)} aria-label="Outdent" title="Outdent (Shift+Tab)"><Outdent size={16} /></button>
          <button className="btn" disabled={!canIndent(o, here)} onClick={() => structural(indent(o, here), here)} aria-label="Indent" title="Indent (Tab)"><Indent size={16} /></button>
          <button className="btn" disabled={!up} onClick={() => structural(moveUp(o, here), here)} aria-label="Move up" title="Move up (Alt+Up)"><ArrowUp size={16} /></button>
          <button className="btn" disabled={!down} onClick={() => structural(moveDown(o, here), here)} aria-label="Move down" title="Move down (Alt+Down)"><ArrowDown size={16} /></button>
          <button className="btn" onClick={() => { const a = addAfter(o, here); setFolded(new Set()); commit(a.outline, a.index); }} aria-label="Add a block below" title="Add below (Enter)"><Plus size={16} /></button>
          <button className="btn" onClick={() => { setFolded(new Set()); commit(remove(o, here)); }} aria-label="Delete" title={hasKids ? "Delete with what is under it" : "Delete"}><Trash2 size={16} /></button>
        </div>
      </div>,
    );
    if (isFolded) i = row.end - 1;
  }

  return (
    <div className="space-y-0.5">
      {out}
      <div className="flex gap-2 pt-2">
        <button className="btn" onClick={() => append("", 0)}><Plus size={16} /> Block</button>
        <button className="btn" onClick={() => append("NEW HEADING", 0)}><Plus size={16} /> Heading</button>
      </div>
    </div>
  );
}
