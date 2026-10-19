import { useMemo, useState } from "react";
import { AlertTriangle, ArrowRight, FolderInput, X } from "lucide-react";
import { META_DEFAULTS, META_VALUES, STATUS_VOCAB, type MetaField } from "../data";
import type { Doc } from "../types";
import type { Fields } from "../yamlEdit";

const LABEL: Record<MetaField, string> = { importance: "Importance", priority: "Priority", severity: "Severity" };

/** Offer VALUES in the spelling this repository already uses for the field, which differs between repositories. */
function inRepositoryCase(values: string[], used: string[]): string[] {
  const lower = used.some((u) => values.some((v) => u === v.toLowerCase() && u !== v));
  const upper = used.some((u) => values.some((v) => u === v[0].toUpperCase() + v.slice(1) && u !== v));
  return values.map((v) => (lower ? v.toLowerCase() : upper ? v[0].toUpperCase() + v.slice(1) : v));
}

/**
 * Status, the classifying fields and the date, at the top of a document.
 * Status goes through the service, which files a finished document under
 * completed/, so a change is confirmed first. The date is when the document
 * was first written and is shown, not offered for change.
 */
export default function Meta({ doc, fields, dirty, refinesOk, onField, onStatus, onTags, onRefines }: {
  doc: Doc; fields: Fields; dirty: boolean; refinesOk: (ref: string) => boolean;
  onField: (field: MetaField, value: string) => void;
  onTags: (tags: string[]) => void; onRefines: (refines: string[]) => void;
  onStatus: (status: string) => Promise<void>;
}) {
  const [pending, setPending] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const vocab = STATUS_VOCAB[doc.type];
  const shown = useMemo(() => {
    const present = (["importance", "priority", "severity"] as MetaField[]).filter((f) => fields[f] !== "");
    const wanted = (META_DEFAULTS[doc.type] ?? []);
    return (["importance", "priority", "severity"] as MetaField[]).filter((f) => present.includes(f) || wanted.includes(f));
  }, [fields.importance, fields.priority, fields.severity, doc.type]);

  const options = (f: MetaField) => {
    const current = fields[f];
    const base = META_VALUES(f, doc.type);
    const list = inRepositoryCase(base, current ? [current] : []);
    return current && !list.includes(current) ? [current, ...list] : list;
  };

  const willFile = pending !== null && vocab?.terminal.includes(pending) && !vocab.terminal.includes(fields.status);
  const willUnfile = pending !== null && vocab && !vocab.terminal.includes(pending) && vocab.terminal.includes(fields.status);

  return (
    <>
      <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-mute">
        <label className="flex items-center gap-1.5">Status
          {vocab ? (
            <select className="input !w-auto" value={fields.status} disabled={dirty} title={dirty ? "Save or undo your edits before changing the status." : undefined}
              onChange={(e) => setPending(e.target.value)}>
              {[...new Set([fields.status, ...vocab.allowed])].filter(Boolean).map((s) => <option key={s}>{s}</option>)}
            </select>
          ) : <span className="text-ink">{fields.status || "—"}</span>}
        </label>
        {shown.map((f) => (
          <label key={f} className="flex items-center gap-1.5">{LABEL[f]}
            <select className="input !w-auto" value={fields[f]} onChange={(e) => onField(f, e.target.value)}>
              <option value=""></option>
              {options(f).map((v) => <option key={v}>{v}</option>)}
            </select>
          </label>
        ))}
        <span title="The date the document was first written. It is not changed here.">Drafted <span className="text-ink">{fields.date || "—"}</span></span>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-1.5 text-xs text-mute">
        <span className="mr-1">Tags</span>
        {fields.tags.map((t) => (
          <span key={t} className="chip">{t}
            <button aria-label={`Remove ${t}`} onClick={() => onTags(fields.tags.filter((x) => x !== t))}><X size={12} /></button>
          </span>
        ))}
        <input className="chip md:!min-h-0 w-28 outline-none" placeholder="add tag" onKeyDown={(e) => {
          const v = e.currentTarget.value.trim();
          if (e.key === "Enter" && v) { onTags([...fields.tags, v]); e.currentTarget.value = ""; }
        }} />
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-1.5 text-xs text-mute">
        <span className="mr-1">Refines</span>
        {fields.refines.map((r) => (
          <span key={r} className={`chip ${refinesOk(r) ? "" : "!border-red-500 text-red-500"}`}>
            {!refinesOk(r) && <AlertTriangle size={12} />}{r}
            <button aria-label={`Remove ${r}`} onClick={() => onRefines(fields.refines.filter((x) => x !== r))}><X size={12} /></button>
          </span>
        ))}
        <input className="chip md:!min-h-0 w-28 outline-none" placeholder="add id or @repo/id" onKeyDown={(e) => {
          const raw = e.currentTarget.value.trim(); const v = raw.startsWith("@") ? raw : raw.toUpperCase();
          if (e.key === "Enter" && v) { onRefines([...fields.refines, v]); e.currentTarget.value = ""; }
        }} />
      </div>

      {pending !== null && (
        <div className="fixed inset-0 z-[55] flex items-end justify-center bg-black/50 sm:items-center sm:p-6">
          <div className="w-full max-w-md rounded-t-2xl bg-panel p-4 shadow-xl sm:rounded-2xl">
            <h3 className="mb-2 flex items-center gap-2 text-lg font-semibold">
              {doc.id}: <span className="text-mute">{fields.status || "none"}</span> <ArrowRight size={16} /> {pending}
            </h3>
            <p className="mb-2 text-sm">The service rewrites the status line of the file and indexes it again. Nothing else in the document changes.</p>
            {willFile && <p className="mb-2 flex gap-2 text-sm"><FolderInput size={16} className="mt-0.5 shrink-0" />A finished document is filed in the <code>completed/</code> folder next to the others of its kind, so its path changes.</p>}
            {willUnfile && <p className="mb-2 flex gap-2 text-sm"><FolderInput size={16} className="mt-0.5 shrink-0" />The document is moved out of <code>completed/</code> back beside the open ones.</p>}
            {doc.type === "PLAN" && pending === "final" && (
              <p className="mb-2 flex gap-2 text-sm text-amber-700 dark:text-amber-400"><AlertTriangle size={16} className="mt-0.5 shrink-0" />
                This sets only this plan. Use Complete… to also restate the requirements and designs it refines.</p>
            )}
            <div className="mt-3 flex justify-end gap-2">
              <button className="btn" disabled={busy} onClick={() => setPending(null)}>Cancel</button>
              <button className="btn btn-primary" disabled={busy} onClick={async () => { setBusy(true); try { await onStatus(pending); } finally { setBusy(false); setPending(null); } }}>Set {pending}</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
