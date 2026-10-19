import { useEffect, useState } from "react";
import type { Client } from "@synoptik/client";
import { Folder, FolderPlus, GitBranch, Pause, Play, Trash2, X, RefreshCw } from "lucide-react";
import Fold from "./Fold";
import { repoColor } from "../data";
import { useWs } from "../context";
import type { Repo } from "../types";

const STATE_STYLE: Record<Repo["state"], string> = {
  ready: "bg-emerald-500", indexing: "bg-amber-500 animate-pulse", paused: "bg-slate-400",
};

interface FolderRow { name: string; path: string; git: boolean; watched: boolean }

export default function Workspace({
  client, repos, reload, counts, onClose, toast, folded, onFold,
}: { client: Client; repos: Repo[]; reload: () => Promise<void>; counts: Record<string, number>; onClose: () => void; toast: (m: string) => void; folded: boolean; onFold: () => void }) {
  const [picking, setPicking] = useState(false);
  const [confirm, setConfirm] = useState<string | null>(null);
  const [folders, setFolders] = useState<{ roots: string[]; folders: FolderRow[] } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const names = useWs().repoNames;

  useEffect(() => {
    if (!picking) return;
    void (client("GET", "/api/folders") as Promise<unknown> as Promise<{ roots: string[]; folders: FolderRow[] }>)
      .then(setFolders).catch((e) => toast(e.message));
  }, [picking, client, toast]);

  // Every change goes to the service and then the list is read again, so what
  // is shown is what the service holds.
  const run = async (label: string, operation: string, body: Record<string, string>) => {
    setBusy(label);
    try {
      await client("POST", `/api/v1/${operation}`, body);
      toast(label);
      await reload();
    } catch (e: any) {
      toast(`${label} failed: ${e?.message ?? e}`);
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className={`flex flex-col bg-panel ${folded ? "" : "h-full"}`}>
      <div className="flex items-center gap-2 border-b border-line p-3">
        <GitBranch size={18} /> <span className="font-semibold">Workspace</span>
        <span className="text-xs text-mute">{repos.length} folders</span>
        <button className="btn btn-primary ml-auto" onClick={() => setPicking(true)}><FolderPlus size={16} /> Add folder</button>
        <Fold folded={folded} onFold={onFold} />
        <button className="btn" onClick={onClose} aria-label="Close workspace"><X size={16} /></button>
      </div>

      <ul className={folded ? "hidden" : "min-h-0 flex-1 space-y-2 overflow-y-auto p-3"}>
        {repos.map((r) => (
          <li key={r.name} className="rounded-xl border border-line p-3">
            <div className="flex items-center gap-2">
              <span className="h-3 w-3 rounded" style={{ background: repoColor(r.name, names) }} />
              <span className="font-semibold">{r.name}</span>
              <span className={`ml-1 h-2 w-2 rounded-full ${STATE_STYLE[r.state]}`} />
              <span className="text-xs text-mute">{r.state}</span>
            </div>
            <div className="mt-1 font-mono text-xs text-mute">{r.path}</div>
            <div className="mt-1 text-xs text-mute">
              {r.missing ? "This folder is no longer on disk. It stays in the workspace until you remove it." : r.state === "indexing" ? "Indexing…" : `${counts[r.name] ?? r.documents} documents · commit ${r.commit || "—"}`}
            </div>
            <div className="mt-2 flex flex-wrap gap-2">
              <button className="btn" disabled={r.state === "indexing" || !!busy || !!r.missing}
                onClick={() => r.state === "paused" ? run(`Resumed ${r.name}`, "watch", { path: r.path }) : run(`Paused ${r.name}`, "pause", { repository: r.name })}>
                {r.state === "paused" ? <><Play size={16} /> Resume</> : <><Pause size={16} /> Pause</>}
              </button>
              <button className="btn" onClick={() => run(`Reindexing ${r.name}`, "reindex", { repository: r.name })} disabled={r.state !== "ready" || !!busy}><RefreshCw size={16} /> Reindex</button>
              <button className="btn" onClick={() => setConfirm(r.name)}><Trash2 size={16} /> Remove</button>
            </div>
          </li>
        ))}
        {repos.length === 0 && <p className="text-sm text-mute">No folders. Add one to see its documents.</p>}
      </ul>

      {picking && (
        <div className="fixed inset-0 z-[55] flex items-end justify-center bg-black/50 sm:items-center sm:p-6">
          <div className="max-h-full w-full max-w-md overflow-y-auto rounded-t-2xl bg-panel p-4 shadow-xl sm:rounded-2xl">
            <div className="mb-2 flex items-center justify-between"><h3 className="text-lg font-semibold">Add folder</h3>
              <button className="btn" onClick={() => setPicking(false)} aria-label="Close"><X size={16} /></button></div>
            {folders === null ? <p className="text-sm text-mute">Loading…</p> : folders.roots.length === 0 ? (
              <p className="text-sm text-mute">No folder roots are configured. Add the directories that hold your repositories to <code>roots</code> in <code>~/.synoptik/web.json</code>, then reopen this.</p>
            ) : (
              <>
                <p className="mb-3 text-xs text-mute">Folders under <code>{folders.roots.join(", ")}</code>. Only git repositories can be added.</p>
                <ul className="space-y-1">
                  {folders.folders.map((c) => {
                    const off = !c.git || c.watched;
                    return (
                      <li key={c.path}>
                        <button disabled={off || !!busy} onClick={() => { setPicking(false); void run(`Added ${c.name}`, "watch", { path: c.path }); }} className="btn w-full !justify-start disabled:!opacity-50">
                          <Folder size={16} /> <span className="truncate font-mono text-xs">{c.path}</span>
                          <span className="ml-auto text-xs text-mute">{c.watched ? "already added" : !c.git ? "not a git repository" : ""}</span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </>
            )}
          </div>
        </div>
      )}

      {confirm && (
        <div className="fixed inset-0 z-[55] flex items-end justify-center bg-black/50 sm:items-center sm:p-6">
          <div className="w-full max-w-md rounded-t-2xl bg-panel p-4 shadow-xl sm:rounded-2xl">
            <h3 className="mb-1 text-lg font-semibold">Remove {confirm} from the workspace?</h3>
            <p className="mb-4 text-sm text-mute">Synoptik stops watching it and drops its index. Nothing on disk is deleted, and adding the folder again rebuilds the index.</p>
            <div className="flex justify-end gap-2">
              <button className="btn" onClick={() => setConfirm(null)}>Cancel</button>
              <button className="btn btn-primary" onClick={() => { const name = confirm; setConfirm(null); const gone = repos.find((r) => r.name === name);
                if (gone?.missing) void (async () => { await client("POST", "/api/workspace/forget", { path: gone.path }); toast(`Removed ${name}`); await reload(); })();
                else void run(`Removed ${name}`, "unwatch", { repository: name }); }}>Remove</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
