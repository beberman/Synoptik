import { useEffect, useState } from "react";
import type { Client } from "@synoptik/client";
import { Bot, Send, X } from "lucide-react";
import { useWs } from "../context";

interface Adapter { id: string; name: string; capabilities: { supported: string[]; notes: Record<string, string> } }

/**
 * Ask an agent to do something to one document. The task is written for the
 * person to read and change before it is sent, and the agent edits the file
 * where the service watches it, so the change reaches the editor on its own.
 */
export default function AskAgent({ client, repo, task: initial, onClose, toast }: {
  client: Client; repo: string; task: string; onClose: () => void; toast: (m: string) => void;
}) {
  const [task, setTask] = useState(initial);
  const [adapters, setAdapters] = useState<Adapter[] | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const path = useWs().repoPaths[repo];

  useEffect(() => {
    void (client("GET", "/api/agents") as Promise<unknown> as Promise<{ adapters: Adapter[] }>)
      .then((a) => setAdapters(a.adapters)).catch((e) => setProblem(e.message));
  }, [client]);
  const adapter = adapters?.find((a) => a.capabilities.supported.includes("launch"));

  const send = async () => {
    if (!adapter || !path) return;
    setSending(true);
    try {
      await client("POST", `/api/agents/${adapter.id}/launch`, { repository: path, task });
      toast(`Sent to ${adapter.name}. The document updates here when the agent saves it.`);
      onClose();
    } catch (e: any) { setProblem(e?.message ?? String(e)); } finally { setSending(false); }
  };

  return (
    <div className="fixed inset-0 z-[55] flex items-end justify-center bg-black/50 sm:items-center sm:p-6">
      <div className="max-h-full w-full max-w-2xl overflow-y-auto rounded-t-2xl bg-panel p-4 shadow-xl sm:rounded-2xl">
        <div className="mb-2 flex items-center gap-2"><Bot size={18} /><h3 className="text-lg font-semibold">Ask an agent</h3>
          <button className="btn ml-auto" onClick={onClose} aria-label="Close"><X size={16} /></button></div>
        <p className="mb-2 text-xs text-mute">Read the task and change it if it is not what you want. The agent works in {path ?? repo}.</p>
        <textarea className="input !min-h-[220px] w-full py-2 font-mono text-xs leading-relaxed" value={task} onChange={(e) => setTask(e.target.value)} aria-label="Task" />
        {adapters && !adapter && <p role="alert" className="mt-2 text-sm text-amber-700 dark:text-amber-400">No agent tool that can start a session is configured. Set one up under Agents.</p>}
        {problem && <p role="alert" className="mt-2 text-sm text-red-600 dark:text-red-400">{problem}</p>}
        <div className="mt-3 flex justify-end gap-2">
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" disabled={!adapter || !task.trim() || sending} onClick={() => void send()}><Send size={16} /> Send{adapter ? ` to ${adapter.name}` : ""}</button>
        </div>
      </div>
    </div>
  );
}
