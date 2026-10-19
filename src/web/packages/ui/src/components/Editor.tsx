import { createPortal } from "react-dom";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Check, Code2, History, MessageSquare, Redo2, Replace, Save, Undo2, X, AlertTriangle, Bot } from "lucide-react";
import { ConflictError, type Client, type CheckResult, type Suggestion, type operations } from "@synoptik/client";
import { indexByKey, refKey } from "../data";
import { useServerEvents } from "../state";
import { parseErrors, readFields, replaceItem, setBlock, setField, setList } from "../yamlEdit";
import type { Doc } from "../types";
import Auto from "./Auto";
import Outline from "./Outline";
import Meta from "./Meta";
import Changes from "./Changes";
import AskAgent from "./AskAgent";
import { useWs } from "../context";

type Ops = ReturnType<typeof operations>;
type Loaded = { text: string; version: string };

export default function Editor({
  client, ops, doc, all, reload, toast, wide, metaSlot,
}: { client: Client; wide?: boolean; metaSlot?: HTMLElement | null; ops: Ops; doc: Doc; all: Doc[]; reload: () => Promise<void>; toast: (m: string) => void }) {
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
  // The text as it was before the last change made outside this editor, which is
  // what going back returns to; and what git holds, asked for only when wanted.
  const [before, setBefore] = useState<Loaded | null>(null);
  const [committed, setCommitted] = useState<Loaded | null>(null);
  const [showChanges, setShowChanges] = useState<"outside" | "commit" | null>(null);
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [ask, setAsk] = useState<string | null>(null);
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
  const { openTerminal } = useWs();
  // The agent edits the file on disk, so an unsaved edit here would meet its
  // change as a conflict. Saving first keeps one version of the text.
  const talk = () => {
    if (!openTerminal) return;
    if (dirty) { toast("Save or undo your edits before talking to the agent about this document."); return; }
    void openTerminal(doc.repo, `I have ${doc.path} open in Synoptik's editor. Read it; I want to talk about it.`);
  };

  // A change made to the file while it is open arrives here: an agent, an editor,
  // a terminal. The server says when the service has read a new text of it; the
  // text is read again then. Without a connection to the server it is read every
  // few seconds while the page is in view.
  const latest = useRef({ loaded, dirty, saving, conflict });
  latest.current = { loaded, dirty, saving, conflict };
  const pull = useRef<() => Promise<void>>(async () => {});
  pull.current = async () => {
    const now = latest.current;
    if (!now.loaded || now.saving) return;
    try {
      const read = await ops.readDocument(doc.repo, doc.id);
      const cur = latest.current;
      if (!cur.loaded || cur.saving || read.version === cur.loaded.version) return;
      if (cur.dirty) {
        // Unsaved edits are never replaced: the person chooses, as for a refused save.
        if (cur.conflict?.version !== read.version) setConflict({ text: read.text, version: read.version });
        return;
      }
      setBefore(cur.loaded);
      setLoaded({ text: read.text, version: read.version });
      setDraft(read.text); setPast([]); setFuture([]);
      toast(`${doc.id} was changed on disk`);
      if (doc.path) setCheck(await ops.checkDocument(doc.repo, doc.path).catch(() => null));
      void reload();
    } catch { /* the service may be restarting; the next event or read tries again */ }
  };
  const live = useServerEvents(client, (event) => {
    if (event.type === "open" || event.type === "reset") void pull.current();
    else if (event.type === "document" && event.repository === doc.repo && event.address === doc.path) void pull.current();
  });
  useEffect(() => {
    if (live) return;
    const timer = setInterval(() => { if (!document.hidden) void pull.current(); }, 4000);
    return () => clearInterval(timer);
  }, [live]);

  // Where a name that resolves to nothing is defined now, asked of the index.
  useEffect(() => {
    if (!check?.references?.some((r) => r.status === "unresolved")) { setSuggestions([]); return; }
    let live = true;
    ops.suggestFixes(doc.repo, doc.id).then((a) => { if (live) setSuggestions(a.suggestions); }).catch(() => { if (live) setSuggestions([]); });
    return () => { live = false; };
  }, [check, ops, doc.repo, doc.id]);

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

  const save = async (version: string, text: string = draft) => {
    if (!loaded) return;
    setSaving(true); setProblem(null);
    try {
      const result = await ops.writeDocument(doc.repo, doc.id, text, version);
      setLoaded({ text, version: result.version });
      setCheck(result.check);
      setConflict(null);
      toast(result.changed ? `Saved ${doc.id}` : "Nothing to save");
      await reload();
    } catch (e: any) {
      if (e instanceof ConflictError) setConflict({ text: e.current.text, version: e.current.version });
      else setProblem(e?.message ?? String(e));
    } finally { setSaving(false); }
  };

  // Write an older text back over the file. Refused while there are unsaved edits,
  // because it would discard them.
  const goBack = async (text: string) => {
    if (!loaded || dirty) return;
    setSaving(true); setProblem(null);
    try {
      const result = await ops.writeDocument(doc.repo, doc.id, text, loaded.version);
      setLoaded({ text, version: result.version });
      setDraft(text); setPast([]); setFuture([]);
      setCheck(result.check); setBefore(null); setShowChanges(null);
      toast("Went back to the older text");
      await reload();
    } catch (e: any) {
      if (e instanceof ConflictError) setConflict({ text: e.current.text, version: e.current.version });
      else setProblem(e?.message ?? String(e));
    } finally { setSaving(false); }
  };

  const showCommitted = async () => {
    try {
      const c = await ops.committedDocument(doc.repo, doc.id);
      setCommitted({ text: c.text, version: c.version }); setShowChanges("commit");
    } catch (e: any) { toast(e?.message ?? String(e)); }
  };

  // Put a suggested name in place of the one that resolves to nothing. With nothing
  // else unsaved it is written at once, so the check answers for the new text.
  const applyFix = (field: string, name: string, replacement: string) => {
    if (field !== "affects" && field !== "refines") return;
    const next = replaceItem(draft, field, name, replacement);
    if (next === draft) { toast("That entry is not in the text any more"); return; }
    const clean = !dirty;
    change(next);
    if (clean && loaded) void save(loaded.version, next);
    else toast("Changed in the text. Save to check it again.");
  };

  const fixTask = (refs: { ref: string; kind: string }[]) => {
    const lines = refs.map((r) => {
      const found = suggestions.find((s) => s.field === r.kind && s.name === r.ref);
      const hint = found?.candidates.length ? `  (the index now has ${found.candidates.map((c) => c.replacement).join(" or ")})` : "";
      return `- ${r.kind}: ${r.ref}${hint}`;
    }).join("\n");
    return `In ${doc.repo}, the document ${doc.path} (${doc.id}) declares references that resolve to nothing in the index:\n\n${lines}\n\n` +
      `For each one, find where it is defined now (use the synoptik find and describe tools) and change that reference in the file. ` +
      `Change nothing else in the document. Then run check-document on ${doc.path} and say which references still do not resolve.`;
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
        <button className="btn" onClick={() => void showCommitted()} title="What differs from the last commit"><History size={16} /> <span className="hidden sm:inline">Changes</span></button>
        <span className="flex-1" />
        {dirty && <span className="text-xs text-mute">unsaved</span>}
        <button className="btn btn-primary" disabled={!dirty || saving || yamlErrors.length > 0} onClick={() => void save(loaded.version)}>
          <Save size={16} /> Save
        </button>
      </div>

      {before && (
        <div className="flex flex-wrap items-center gap-2 border-b border-line bg-sky-500/10 p-2 text-sm">
          <span>{doc.id} was changed on disk, outside this editor.</span>
          <button className="btn" onClick={() => setShowChanges("outside")}>Show changes</button>
          <button className="btn" onClick={() => setBefore(null)}>Dismiss</button>
        </div>
      )}

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
          {openTerminal && <button className="btn mb-2 w-full" onClick={talk} title="Open Claude Code in this repository, beside the document"><MessageSquare size={16} /> Talk about this document</button>}
          <button className="mb-2 flex min-h-[44px] w-full items-center gap-2 text-left font-semibold xl:min-h-0 xl:cursor-default" onClick={() => setCheckOpen(!checkOpen)}>
            check_document
            <span className={`chip ${problems ? "!border-red-500 text-red-500" : "!border-emerald-500 text-emerald-600"}`}>{problems ? `${problems} unresolved` : "clean"}</span>
          </button>
          {problems > 0 && <button className="btn mb-2 w-full" onClick={() => setAsk(fixTask(refChecks.filter((c) => !c.ok)))}><Bot size={16} /> Ask an agent to fix {problems}</button>}
          <ul className={`space-y-1 xl:block ${checkOpen ? `block overflow-y-auto ${wide ? "max-h-[50vh]" : "max-h-40"}` : "hidden"}`}>
            {refChecks.map((c, i) => {
              const found = c.ok ? undefined : suggestions.find((x) => x.field === c.kind && x.name === c.ref);
              const fixable = c.kind === "affects" || c.kind === "refines";
              return (
                <li key={i} className={`${wide ? "text-sm" : "text-xs"}`}>
                  <div className="flex items-start gap-1.5">
                    {c.ok ? <Check size={14} className="mt-0.5 shrink-0 text-emerald-500" /> : <AlertTriangle size={14} className="mt-0.5 shrink-0 text-red-500" />}
                    <span className="min-w-0 break-words"><span className="text-mute">{c.kind}</span> <span className="font-mono">{c.ref}</span>{!c.ok && " resolves to nothing"}</span>
                  </div>
                  {!c.ok && (
                    <div className="ml-5 mt-1 flex flex-col items-start gap-1">
                      {found?.candidates.slice(0, 4).map((cand) => (
                        <button key={cand.replacement} className="btn !h-auto !min-h-[36px] max-w-full !justify-start !whitespace-normal text-left" disabled={!fixable}
                          title={cand.replacement} onClick={() => applyFix(c.kind, c.ref, cand.replacement)}>
                          Use <span className="break-all font-mono">{cand.file}</span>
                        </button>
                      ))}
                      {found && found.candidates.length === 0 && <span className="text-mute">Nothing with that name is in the index.</span>}
                      <button className="btn !min-h-[36px]" onClick={() => setAsk(fixTask([c]))}><Bot size={14} /> Ask an agent</button>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
          <p className="mt-3 text-xs text-mute">As the service last read the file: {check ? "check-document" : "not checked"}. Saving checks the text written.</p>
        </aside>
      </div>

      {showChanges === "outside" && before && (
        <Changes title="What changed on disk" note="Red lines were in the text before the change; green lines are there now."
          older={before.text} newer={loaded.text} canRevert={!dirty} onRevert={() => void goBack(before.text)} onClose={() => setShowChanges(null)} />
      )}
      {showChanges === "commit" && committed && (
        <Changes title="Since the last commit" note="Red lines are what git holds; green lines are the file now. Going back writes git's text over the file."
          older={committed.text} newer={loaded.text} canRevert={!dirty} onRevert={() => void goBack(committed.text)} onClose={() => setShowChanges(null)} />
      )}
      {ask !== null && <AskAgent client={client} repo={doc.repo} task={ask} onClose={() => setAsk(null)} toast={toast} />}

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
