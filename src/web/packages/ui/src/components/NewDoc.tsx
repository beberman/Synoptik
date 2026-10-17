import { useState } from "react";
import { X } from "lucide-react";
import { TYPE_META, key, shortTitle } from "../data";
import { TypeIcon } from "./DocCard";
import type { Doc } from "../types";

export default function NewDoc({
  ops, all, repoNames, defaultRepo, onCreated, onClose,
}: {
  ops: ReturnType<typeof import("@synoptik/client").operations>; all: Doc[]; repoNames: string[]; defaultRepo?: string;
  onCreated: (repo: string, id: string, address: string) => Promise<void>; onClose: () => void;
}) {
  const [type, setType] = useState<"REQ" | "BUG">("REQ");
  const [title, setTitle] = useState("");
  const [refines, setRefines] = useState<string[]>([]);
  const [q, setQ] = useState("");
  const [repo, setRepo] = useState(defaultRepo && repoNames.includes(defaultRepo) ? defaultRepo : repoNames[0] ?? "");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const options = q ? all.filter((d) => (d.id + d.title + d.repo).toLowerCase().includes(q.toLowerCase())).slice(0, 6) : [];

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 sm:items-center sm:p-6">
      <div className="max-h-full w-full max-w-lg overflow-y-auto rounded-t-2xl bg-panel p-4 shadow-xl sm:rounded-2xl">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-lg font-semibold">New document</h3>
          <button className="btn" onClick={onClose} aria-label="Close"><X size={16} /></button>
        </div>
        <div className="mb-3 grid grid-cols-2 gap-2">
          {(["REQ", "BUG"] as const).map((t) => (
            <button key={t} onClick={() => setType(t)} className={`btn !justify-start gap-2 ${type === t ? "!border-accent ring-2 ring-accent/30" : ""}`}>
              <TypeIcon type={t} size={26} /> {TYPE_META[t].label}
            </button>
          ))}
        </div>
        <p className="mb-3 text-xs text-mute">Only requirements and bugs are created here. Designs, plans, decisions and the rest are drafted by agents and edited here.</p>
        <label className="mb-3 block text-xs text-mute">Repository
          <select className="input mt-1 text-ink" value={repo} onChange={(e) => setRepo(e.target.value)}>{repoNames.map((r) => <option key={r}>{r}</option>)}</select>
        </label>
        <div className="mb-1 text-xs text-mute">The service assigns the next free id in {repo} when this is created.</div>
        <input className="input mb-3" placeholder="Title, as a sentence a reader can check" value={title} onChange={(e) => setTitle(e.target.value)} autoFocus />
        <div className="mb-1 text-xs text-mute">Refines (optional)</div>
        <div className="mb-2 flex flex-wrap gap-1.5">
          {refines.map((r) => <span key={r} className="chip">{r}<button onClick={() => setRefines(refines.filter((x) => x !== r))} aria-label={`Remove ${r}`}><X size={12} /></button></span>)}
        </div>
        <input className="input" placeholder="Search a document to refine" value={q} onChange={(e) => setQ(e.target.value)} />
        {options.length > 0 && (
          <ul className="mt-1 overflow-hidden rounded-lg border border-line">
            {options.map((d) => (
              <li key={key(d)}><button className="flex min-h-[44px] w-full items-center gap-2 px-2 text-left text-sm hover:bg-line/40"
                onClick={() => { setRefines([...new Set([...refines, d.repo === repo ? d.id : `@${d.repo}/${d.id}`])]); setQ(""); }}>
                <TypeIcon type={d.type} size={24} /><span className="font-mono text-xs">{d.repo === repo ? d.id : `@${d.repo}/${d.id}`}</span><span className="truncate">{shortTitle(d.title)}</span></button></li>
            ))}
          </ul>
        )}
        {problem && <p role="alert" className="mt-3 whitespace-pre-wrap text-sm text-red-600 dark:text-red-400">{problem}</p>}
        <div className="mt-4 flex justify-end gap-2">
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" disabled={!title.trim() || busy || !repo} onClick={async () => {
            setBusy(true); setProblem(null);
            try {
              const made = await ops.createDocument(repo, type === "REQ" ? "req" : "bug", title.trim(), refines);
              await onCreated(repo, made["doc-id"], made.address);
            } catch (e: any) { setProblem(e?.message ?? String(e)); setBusy(false); }
          }}>Create</button>
        </div>
      </div>
    </div>
  );
}
