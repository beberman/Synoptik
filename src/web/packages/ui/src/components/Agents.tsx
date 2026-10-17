import { useCallback, useEffect, useState } from "react";
import { Bot, Play, X } from "lucide-react";
import type { Client } from "@synoptik/client";
import type { AgentStatus, Repo, Session } from "../types";

const COLOR: Record<AgentStatus, string> = {
  working: "bg-sky-500", "waiting-input": "bg-amber-500", "waiting-approval": "bg-orange-500",
  idle: "bg-slate-400", finished: "bg-emerald-500", failed: "bg-red-500", unknown: "bg-slate-300",
};

interface AdapterInfo { id: string; name: string; capabilities: { supported: string[]; notes: Record<string, string> } }
interface Launch { adapter: string; repository: string; task: string; state: "running" | "finished" | "failed"; error?: string; at: string }

/**
 * The agent tools the server has, each as far as it says it can go. A control
 * shows only for a capability the adapter reported, and for a missing one the
 * adapter's own reason is shown instead (REQ-0080 R10).
 */
export default function Agents({
  client, repos, onClose, toast,
}: { client: Client; repos: Repo[]; onClose: () => void; toast: (m: string) => void }) {
  const [adapters, setAdapters] = useState<AdapterInfo[] | null>(null);
  const [launches, setLaunches] = useState<Launch[]>([]);
  const [sessions, setSessions] = useState<Record<string, Session[]>>({});
  const [task, setTask] = useState("");
  const [repo, setRepo] = useState(repos[0]?.path ?? "");
  const [problem, setProblem] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const answer = (await client("GET", "/api/agents")) as unknown as { adapters: AdapterInfo[]; launches: Launch[] };
      setAdapters(answer.adapters); setLaunches(answer.launches);
      for (const a of answer.adapters) {
        if (!a.capabilities.supported.includes("list")) continue;
        try {
          const body = (await client("GET", `/api/agents/${a.id}/sessions`)) as unknown as { sessions: Session[] };
          setSessions((s) => ({ ...s, [a.id]: body.sessions }));
        } catch (e: any) { setProblem(`${a.name}: ${e.message}`); }
      }
    } catch (e: any) { setProblem(e.message); }
  }, [client]);
  useEffect(() => { void load(); const t = setInterval(() => void load(), 10000); return () => clearInterval(t); }, [load]);

  const launch = async (adapter: AdapterInfo) => {
    try {
      await client("POST", `/api/agents/${adapter.id}/launch`, { repository: repo, task });
      setTask(""); toast(`Sent to ${adapter.name}`); await load();
    } catch (e: any) { toast(e.message); }
  };

  return (
    <div className="flex h-full flex-col bg-panel">
      <div className="flex items-center gap-2 border-b border-line p-3">
        <Bot size={18} /> <span className="font-semibold">Agents</span>
        <button className="btn ml-auto" onClick={onClose} aria-label="Close agents"><X size={16} /></button>
      </div>
      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-3">
        {problem && <p role="alert" className="text-sm text-red-600 dark:text-red-400">{problem}</p>}
        {adapters === null && <p className="text-sm text-mute">Loading…</p>}
        {adapters?.map((a) => {
          const can = (c: string) => a.capabilities.supported.includes(c);
          return (
            <section key={a.id} className="space-y-2 rounded-xl border border-line p-3">
              <div className="font-semibold">{a.name}</div>
              {a.capabilities.supported.length === 0 && <p className="text-xs text-mute">{Object.values(a.capabilities.notes)[0] ?? "This tool reports no capability."}</p>}
              {!can("list") && a.capabilities.notes.list && a.capabilities.supported.length > 0 && <p className="text-xs text-mute">{a.capabilities.notes.list}</p>}
              {can("launch") && (
                <form className="space-y-2" onSubmit={(e) => { e.preventDefault(); if (task.trim() && repo) void launch(a); }}>
                  <select className="input" value={repo} onChange={(e) => setRepo(e.target.value)} aria-label="Folder">
                    {repos.map((r) => <option key={r.path} value={r.path}>{r.name}</option>)}
                  </select>
                  <textarea className="input !min-h-[72px] py-2" placeholder="Task, e.g. Draft the plan for REQ-0081" value={task} onChange={(e) => setTask(e.target.value)} />
                  <button className="btn btn-primary w-full" type="submit"><Play size={16} /> Launch agent</button>
                </form>
              )}
              {!can("launch") && a.capabilities.supported.length > 0 && a.capabilities.notes.launch && <p className="text-xs text-mute">{a.capabilities.notes.launch}</p>}
              {(sessions[a.id] ?? []).map((s) => (
                <div key={s.id} className="rounded-lg border border-line p-2">
                  <div className="flex items-center gap-2 text-xs">
                    <span className={`h-2.5 w-2.5 rounded-full ${COLOR[s.status]}`} />
                    <span className="font-semibold">{s.status}</span>
                    <span className="truncate text-mute">· {s.repository.split("/").pop()} · {s.since ? new Date(s.since).toLocaleString() : "—"}</span>
                  </div>
                  <div className="mt-1 text-sm">{s.task}</div>
                </div>
              ))}
              {can("list") && !(sessions[a.id]?.length) && <p className="text-xs text-mute">No sessions.</p>}
              {a.capabilities.supported.includes("list") && !can("status") && <p className="text-xs text-mute">{a.capabilities.notes.status}</p>}
            </section>
          );
        })}
        {launches.length > 0 && (
          <section className="space-y-1 rounded-xl border border-line p-3">
            <div className="text-xs font-semibold uppercase tracking-wide text-mute">Sent from here</div>
            {launches.map((l, i) => (
              <div key={i} className="text-sm">
                <span className="font-semibold">{l.state}</span> · {l.repository.split("/").pop()} · {l.task}
                {l.error && <div className="text-xs text-red-600 dark:text-red-400">{l.error}</div>}
              </div>
            ))}
          </section>
        )}
      </div>
    </div>
  );
}
