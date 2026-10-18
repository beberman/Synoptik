import { useMemo, useState } from "react";
import type { Client, operations } from "@synoptik/client";
import { ArrowRight, X, ListChecks, Maximize2, Minimize2 } from "lucide-react";
import Editor from "./Editor";
import DocCard, { TypeIcon } from "./DocCard";
import { metaOf, indexByKey, key, refKey } from "../data";
import type { Doc } from "../types";

export default function DocPanel({
  client, ops, doc, all, onClose, wide, onWide, onSelect, toast, reload,
}: {
  client: Client; ops: ReturnType<typeof operations>; doc: Doc; all: Doc[]; onClose: () => void; wide: boolean; onWide: () => void;
  onSelect: (id: string) => void; toast: (m: string) => void; reload: () => Promise<void>;
}) {
  const [tab, setTab] = useState<"edit" | "relations">("edit");
  const [metaSlot, setMetaSlot] = useState<HTMLElement | null>(null);
  const [dry, setDry] = useState<string | null>(null);
  const byKey = useMemo(() => indexByKey(all), [all]);
  const refinedBy = all.filter((d) => d.refines.some((r) => refKey(r, d.repo) === key(doc)));

  // The service computes what completing a plan would do. Without verdicts it
  // writes nothing, and this shows that answer as it arrived.
  const dryRun = async () => {
    try {
      const answer = await client("POST", "/api/v1/complete", { repository: doc.repo, plan: doc.id });
      setDry(JSON.stringify(answer, null, 2));
    } catch (e: any) { setDry(e?.message ?? String(e)); }
  };

  return (
    <div className="flex h-full flex-col bg-panel">
      <div className="flex items-start gap-3 border-b border-line p-3">
        <TypeIcon type={doc.type} size={40} />
        <div className="min-w-0 flex-1">
          <div className="font-mono text-xs text-mute">{doc.repo} · {doc.id} · {metaOf(doc.type).label} · {doc.path}</div>
          <div className="truncate text-sm font-semibold" title={doc.title}>{doc.title}</div>
          <div ref={setMetaSlot} />
        </div>
        <button className="btn hidden md:inline-flex" onClick={onWide} aria-label={wide ? "Show the document map" : "Hide the document map"} title={wide ? "Show the document map" : "Hide the document map"}>
          {wide ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
        </button>
        <button className="btn" onClick={onClose} aria-label="Close"><X size={16} /></button>
      </div>
      <div className="flex gap-1 border-b border-line px-2 pt-2">
        {(["edit", "relations"] as const).map((t) => (
          <button key={t} onClick={() => setTab(t)}
            className={`min-h-[44px] rounded-t-lg px-4 text-sm font-medium md:min-h-[36px] ${tab === t ? "border-b-2 border-accent text-accent" : "text-mute"}`}>
            {t === "edit" ? "Edit" : "Relationships"}
          </button>
        ))}
        {doc.type === "PLAN" && <button className="btn ml-auto mb-1" onClick={() => void dryRun()}><ListChecks size={16} /> Complete…</button>}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {tab === "edit" ? (
          <Editor client={client} wide={wide} metaSlot={tab === "edit" ? metaSlot : null} ops={ops} doc={doc} all={all} reload={reload} toast={toast} />
        ) : (
          <div className="space-y-5 p-4">
            <Group title="Refines" empty="Refines nothing.">
              {doc.refines.map((r) => byKey.has(refKey(r, doc.repo))
                ? <DocCard key={r} showRepo doc={byKey.get(refKey(r, doc.repo))!} onClick={() => onSelect(refKey(r, doc.repo))} />
                : <div key={r} className="rounded-xl border border-dashed border-red-500 p-2 text-sm text-red-500">{r} — unresolved: no document in the workspace has this id</div>)}
            </Group>
            <Group title={`Refined by (${refinedBy.length})`} empty="Nothing refines it.">
              {refinedBy.map((d) => <DocCard key={key(d)} showRepo doc={d} onClick={() => onSelect(key(d))} />)}
            </Group>
            <Group title="Affects (code)" empty="Names no code.">
              {doc.affects.map((a) => <div key={a} className="flex items-center gap-2 rounded-lg bg-line/30 px-2 py-1.5 font-mono text-xs"><ArrowRight size={12} />{a}</div>)}
            </Group>
          </div>
        )}
      </div>

      {dry !== null && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 sm:items-center sm:p-6">
          <div className="w-full max-w-xl rounded-t-2xl bg-panel p-4 shadow-xl sm:rounded-2xl">
            <h3 className="mb-2 text-lg font-semibold">complete {doc.id} — dry run</h3>
            <pre className="max-h-72 overflow-auto whitespace-pre-wrap rounded-lg bg-line/30 p-3 font-mono text-xs">{dry}</pre>
            <div className="mt-3 flex justify-end"><button className="btn btn-primary" onClick={() => setDry(null)}>Close</button></div>
          </div>
        </div>
      )}
    </div>
  );
}

function Group({ title, empty, children }: { title: string; empty: string; children: React.ReactNode[] }) {
  return (
    <section>
      <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-mute">{title}</h4>
      <div className="space-y-1.5">{children.length ? children : <p className="text-sm text-mute">{empty}</p>}</div>
    </section>
  );
}
