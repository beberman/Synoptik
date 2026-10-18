import { createPortal } from "react-dom";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Check, Code2, Redo2, Replace, Save, Undo2, X, AlertTriangle } from "lucide-react";
import { ConflictError, type CheckResult, type operations } from "@synoptik/client";
import { indexByKey, refKey } from "../data";
import { parseErrors, readFields, setBlock, setField, setList } from "../yamlEdit";
import type { Doc } from "../types";
import Auto from "./Auto";
import Outline from "./Outline";
import Meta from "./Meta";

type Ops = ReturnType<typeof operations>;
type Loaded = { text: string; version: string };

export default function Editor({
  ops, doc, all, reload, toast, wide, metaSlot,
}: { wide?: boolean; metaSlot?: HTMLElement | null; ops: Ops; doc: Doc; all: Doc[]; reload: () => Promise<void>; toast: (m: string) => void }) {
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [draft, setDraft] = useState("");
  const [past, setPast] = useState<string[]>([]);
  const [future, setFuture] = useState<string[]>([]);
  const [raw, setRaw] = useState(false);
  const [find, setFind] = useState("");
  const [repl, setRepl] = useState("");
  const [showFind, setShowFind] = useState(false);
  const [conflict, setConflict] = useState<Loaded | null>(null);
  const [checkOpen, setCheckOpen] = useState(false);
  // Width of the check_document column, kept per browser. Dragging the divider
  // or pressing the arrow keys on it changes it.
  const [side, setSide] = useState<number | null>(() => {
    try { const n = Number(localStorage.getItem("synoptik.checkWidth")); return n >= 160 ? n : null; } catch { return null; }
  });
  const sideWidth = side ?? (wide ? 448 : 256);
  const resize = (px: number) => {
    const n = Math.max(160, Math.min(900, Math.round(px)));
    setSide(n);
    try { localStorage.setItem("synoptik.checkWidth", String(n)); } catch { /* not kept */ }
  };
  const startDrag = (e: React.PointerEvent) => {
    e.preventDefault();
    const x0 = e.clientX, w0 = sideWidth;
    const move = (m: PointerEvent) => resize(w0 + (x0 - m.clientX));
    const up = () => { window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up); };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };
  const [check, setCheck] = useState<CheckResult | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const open = useCallback(async () => {
    setProblem(null);
    try {
      const read = await ops.readDocument(doc.repo, doc.id);
      setLoaded({ text: read.text, version: read.version });
      setDraft(read.text); setPast([]); setFuture([]);
      if (doc.path) setCheck(await ops.checkDocument(doc.repo, doc.path).catch(() => null));
    } catch (e: any) { setProblem(e?.message ?? String(e)); }
  }, [ops, doc.repo, doc.id, doc.path]);
  useEffect(() => { void open(); }, [open]);

  const fields = useMemo(() => readFields(draft), [draft]);
  const yamlErrors = useMemo(() => parseErrors(draft), [draft]);
  const dirty = loaded !== null && draft !== loaded.text;

  const change = (next: string) => { if (next === draft) return; setPast((p) => [...p.slice(-99), draft]); setFuture([]); setDraft(next); };
  const undo = () => { const p = past[past.length - 1]; if (p === undefined) return; setFuture((f) => [draft, ...f]); setPast(past.slice(0, -1)); setDraft(p); };
  const redo = () => { const n = future[0]; if (n === undefined) return; setPast((p) => [...p, draft]); setFuture(future.slice(1)); setDraft(n); };

  const byKey = useMemo(() => indexByKey(all), [all]);
  const resolves = (r: string) => byKey.has(refKey(r, doc.repo));

  const hits = find ? (fields.title + fields.summary + fields.body).split(find).length - 1 : 0;
  const replaceAll = () => {
    if (!find) return;
    let next = setField(draft, "title", fields.title.split(find).join(repl));
    next = setBlock(next, "summary", fields.summary.split(find).join(repl));
    next = setBlock(next, "body", fields.body.split(find).join(repl));
    change(next);
    toast(`Replaced ${hits} occurrence${hits === 1 ? "" : "s"}`);
  };

  const save = async (version: string) => {
    if (!loaded) return;
    setSaving(true); setProblem(null);
    try {
      const result = await ops.writeDocument(doc.repo, doc.id, draft, version);
      setLoaded({ text: draft, version: result.version });
      setCheck(result.check);
      setConflict(null);
      toast(result.changed ? `Saved ${doc.id}` : "Nothing to save");
      await reload();
    } catch (e: any) {
      if (e instanceof ConflictError) setConflict({ text: e.current.text, version: e.current.version });
      else setProblem(e?.message ?? String(e));
    } finally { setSaving(false); }
  };

  const setStatus = async (status: string) => {
    if (dirty) { toast("Save or undo your edits before changing the status."); return; }
    try {
      await ops.setStatus(doc.repo, doc.id, status);
      toast(`${doc.id} is now ${status}`);
      await reload();
      await open();
    } catch (e: any) { toast(e?.message ?? String(e)); }
  };

  const refChecks = (check?.references ?? []).map((r) => ({
    ref: r.name, kind: r.field, ok: r.status === "resolved" || r.status === "self", detail: r.status,
  }));
  const problems = refChecks.filter((c) => !c.ok).length;
  const refinesOk = (r: string) => {
    const found = check?.references?.find((x) => x.field === "refines" && x.name === r);
    return found ? found.status === "resolved" || found.status === "self" : resolves(r);
  };

  if (problem && !loaded) return <div className="p-4 text-sm text-red-600 dark:text-red-400" role="alert">{problem}</div>;
  if (!loaded) return <div className="p-4 text-sm text-mute">Opening {doc.id}…</div>;

  const meta = (
    <Meta doc={doc} fields={fields} dirty={dirty} refinesOk={refinesOk} onStatus={setStatus}
      onField={(f, v) => change(setField(draft, f, v))}
      onTags={(t) => change(setList(draft, "tags", t))} onRefines={(r) => change(setList(draft, "refines", r))} />
  );

  return (
    <div className="flex h-full flex-col">
      {metaSlot && createPortal(meta, metaSlot)}
      <div className="flex flex-wrap items-center gap-1.5 border-b border-line p-2">
        <button className="btn" onClick={undo} disabled={!past.length} aria-label="Undo"><Undo2 size={16} /></button>
        <button className="btn" onClick={redo} disabled={!future.length} aria-label="Redo"><Redo2 size={16} /></button>
        <button className="btn" onClick={() => setShowFind(!showFind)} aria-label="Find and replace"><Replace size={16} /> <span className="hidden sm:inline">Find</span></button>
        <button className={`btn ${raw ? "!border-accent text-accent" : ""}`} onClick={() => setRaw(!raw)}><Code2 size={16} /> YAML</button>
        <span className="flex-1" />
        {dirty && <span className="text-xs text-mute">unsaved</span>}
        <button className="btn btn-primary" disabled={!dirty || saving || yamlErrors.length > 0} onClick={() => void save(loaded.version)}>
          <Save size={16} /> Save
        </button>
      </div>

      {showFind && (
        <div className="flex flex-wrap items-center gap-2 border-b border-line bg-line/20 p-2">
          <input className="input !w-40" placeholder="Find" value={find} onChange={(e) => setFind(e.target.value)} />
          <input className="input !w-40" placeholder="Replace with" value={repl} onChange={(e) => setRepl(e.target.value)} />
          <span className="text-xs text-mute">{find ? `${hits} match${hits === 1 ? "" : "es"}` : ""}</span>
          <button className="btn" disabled={!hits} onClick={replaceAll}>Replace all</button>
        </div>
      )}

      <div className="flex min-h-0 flex-1 flex-col xl:flex-row">
        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          {raw ? (
            <textarea spellCheck={false} value={draft} onChange={(e) => change(e.target.value)}
              className="h-full min-h-[60vh] w-full resize-none rounded-lg border border-line bg-line/20 p-3 font-mono text-xs leading-relaxed outline-none focus:border-accent" />
          ) : (
            <>
              {yamlErrors.length > 0 && <p role="alert" className="mb-2 rounded bg-red-500/10 p-2 text-xs text-red-600 dark:text-red-400">This text is not valid YAML: {yamlErrors[0]}. Fix it in the YAML view before saving.</p>}
              {problem && <p role="alert" className="mb-2 whitespace-pre-wrap rounded bg-red-500/10 p-2 text-xs text-red-600 dark:text-red-400">{problem}</p>}
              <Auto value={fields.title} onChange={(t) => change(setField(draft, "title", t))} className="text-lg font-semibold leading-snug" />
              {fields.summary && <><div className="text-xs font-semibold uppercase tracking-wider text-mute">Summary</div><Outline key="summary" text={fields.summary} onChange={(t) => change(setBlock(draft, "summary", t))} /></>}
              {fields.body && <div className="mt-4 border-t border-line pt-2"><Outline key="body" text={fields.body} onChange={(t) => change(setBlock(draft, "body", t))} /></div>}
            </>
          )}
        </div>

        <div role="separator" aria-orientation="vertical" aria-label="Resize the check_document column" tabIndex={0}
          title="Drag to resize. Double-click to reset."
          onPointerDown={startDrag} onDoubleClick={() => { setSide(null); try { localStorage.removeItem("synoptik.checkWidth"); } catch { /* not kept */ } }}
          onKeyDown={(e) => { if (e.key === "ArrowLeft") { e.preventDefault(); resize(sideWidth + 24); } if (e.key === "ArrowRight") { e.preventDefault(); resize(sideWidth - 24); } }}
          className="hidden w-2 shrink-0 cursor-col-resize touch-none border-l border-line hover:bg-accent/30 focus:bg-accent/40 focus:outline-none xl:block" />
        <aside style={{ ["--side" as string]: `${sideWidth}px` }} className="shrink-0 overflow-y-auto border-t border-line p-3 text-sm xl:max-h-none xl:w-[var(--side)] xl:border-t-0">
          <button className="mb-2 flex min-h-[44px] w-full items-center gap-2 text-left font-semibold xl:min-h-0 xl:cursor-default" onClick={() => setCheckOpen(!checkOpen)}>
            check_document
            <span className={`chip ${problems ? "!border-red-500 text-red-500" : "!border-emerald-500 text-emerald-600"}`}>{problems ? `${problems} unresolved` : "clean"}</span>
          </button>
          <ul className={`space-y-1 xl:block ${checkOpen ? `block overflow-y-auto ${wide ? "max-h-[50vh]" : "max-h-40"}` : "hidden"}`}>
            {refChecks.map((c, i) => (
              <li key={i} className={`flex items-start gap-1.5 ${wide ? "text-sm" : "text-xs"}`}>
                {c.ok ? <Check size={14} className="mt-0.5 shrink-0 text-emerald-500" /> : <AlertTriangle size={14} className="mt-0.5 shrink-0 text-red-500" />}
                <span><span className="text-mute">{c.kind}</span> <span className="font-mono">{c.ref}</span>{!c.ok && " resolves to nothing"}</span>
              </li>
            ))}
          </ul>
          <p className="mt-3 text-xs text-mute">As the service last read the file: {check ? "check-document" : "not checked"}. Saving checks the text written.</p>
        </aside>
      </div>

      {conflict && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-0 sm:items-center sm:p-6">
          <div className="max-h-full w-full max-w-3xl overflow-y-auto rounded-t-2xl bg-panel p-4 shadow-xl sm:rounded-2xl">
            <h3 className="mb-1 text-lg font-semibold">This file changed since you opened it</h3>
            <p className="mb-3 text-sm text-mute">The save was refused and nothing was written. Choose which text to keep.</p>
            <div className="grid gap-3 sm:grid-cols-2">
              <div><div className="mb-1 text-xs font-semibold uppercase text-mute">Your text</div>
                <pre className="max-h-56 overflow-auto whitespace-pre-wrap rounded-lg bg-line/30 p-2 font-mono text-xs">{draft}</pre></div>
              <div><div className="mb-1 text-xs font-semibold uppercase text-mute">On disk now</div>
                <pre className="max-h-56 overflow-auto whitespace-pre-wrap rounded-lg bg-amber-500/10 p-2 font-mono text-xs">{conflict.text}</pre></div>
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <button className="btn" onClick={() => setConflict(null)}>Cancel</button>
              <button className="btn" onClick={() => void save(conflict.version)}>Keep mine</button>
              <button className="btn btn-primary" onClick={() => { setLoaded(conflict); setDraft(conflict.text); setPast([]); setFuture([]); setConflict(null); void reload(); }}>Take theirs</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
