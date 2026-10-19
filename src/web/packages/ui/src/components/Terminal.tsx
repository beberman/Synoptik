import { useEffect, useRef, useState } from "react";
import type { Client } from "@synoptik/client";
import { Terminal as Xterm } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";
import { Maximize2, Minimize2, Power, RotateCw, SquareTerminal, X } from "lucide-react";
import Fold from "./Fold";

/** A terminal the page has open: which adapter holds it, its name there, and its repository. */
export interface OpenTerminal { adapter: string; name: string; repository: string }

const LIGHT = { background: "#ffffff", foreground: "#1e293b", cursor: "#1e293b", selectionBackground: "#bfdbfe" };
const DARK = { background: "#0f172a", foreground: "#e2e8f0", cursor: "#e2e8f0", selectionBackground: "#334155" };

/**
 * Claude Code's own interface, running in tmux on the machine with the files
 * (REQ-0080 R23, DES-0057 D21). Closing this panel detaches; the conversation
 * keeps running, and opening it again returns to it. "End" ends it.
 */
export default function TerminalPanel({ client, term, dark, onHide, onEnded, toast, folded, onFold, full, onFull }: {
  client: Client; term: OpenTerminal; dark: boolean; onHide: () => void; onEnded: () => void; toast: (m: string) => void;
  folded: boolean; onFold: () => void; full: boolean; onFull: () => void;
}) {
  const box = useRef<HTMLDivElement>(null);
  const xterm = useRef<Xterm | null>(null);
  const [state, setState] = useState<"connecting" | "open" | "closed">("connecting");
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!box.current) return;
    if (!client.socket) { setState("closed"); toast("This page cannot open a terminal: it has no WebSocket."); return; }
    const x = new Xterm({
      cursorBlink: true, fontSize: 13, scrollback: 5000, allowProposedApi: false,
      fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace',
      theme: document.documentElement.classList.contains("dark") ? DARK : LIGHT,
    });
    const fit = new FitAddon();
    x.loadAddon(fit);
    x.open(box.current);
    try { fit.fit(); } catch { /* not laid out yet */ }
    xterm.current = x;

    const path = `/api/agents/${encodeURIComponent(term.adapter)}/terminals/${encodeURIComponent(term.name)}/io?cols=${x.cols}&rows=${x.rows}`;
    const socket = client.socket(path);
    const encoder = new TextEncoder();
    const send = (data: string) => { if (socket.readyState === WebSocket.OPEN) socket.send(encoder.encode(data)); };
    socket.onopen = () => { setState("open"); x.focus(); };
    socket.onmessage = (e) => { if (e.data instanceof ArrayBuffer) x.write(new Uint8Array(e.data)); else x.write(String(e.data)); };
    socket.onclose = () => setState("closed");
    const typed = x.onData(send);
    const binary = x.onBinary(send);
    const resize = x.onResize(({ cols, rows }) => {
      if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: "resize", cols, rows }));
    });
    const observer = new ResizeObserver(() => { try { fit.fit(); } catch { /* hidden */ } });
    observer.observe(box.current);

    return () => {
      observer.disconnect(); typed.dispose(); binary.dispose(); resize.dispose();
      socket.onclose = null; socket.close();
      x.dispose(); xterm.current = null;
    };
  }, [client, term.adapter, term.name, attempt]);

  useEffect(() => { if (xterm.current) xterm.current.options.theme = dark ? DARK : LIGHT; }, [dark]);

  const end = async () => {
    if (!window.confirm("End this conversation? Claude Code stops, and the terminal closes for every window attached to it.")) return;
    try {
      await client("POST", `/api/agents/${encodeURIComponent(term.adapter)}/terminals/${encodeURIComponent(term.name)}/close`, {});
      onEnded();
    } catch (e: any) { toast(e?.message ?? String(e)); }
  };

  return (
    <div className={`flex flex-col bg-panel ${folded ? "" : "h-full"}`}>
      <div className="flex items-center gap-2 border-b border-line px-3 py-2">
        <SquareTerminal size={16} />
        <span className="truncate text-sm font-semibold">Claude Code · {term.repository.replace(/\/$/, "").split("/").pop()}</span>
        <span className={`h-2 w-2 shrink-0 rounded-full ${state === "open" ? "bg-emerald-500" : state === "connecting" ? "bg-amber-500" : "bg-slate-400"}`} title={state} />
        <span className="hidden truncate text-xs text-mute sm:inline">tmux attach -t {term.name}</span>
        <div className="ml-auto flex gap-1">
          <Fold folded={folded} onFold={onFold} />
          <button className="btn !min-h-[32px]" onClick={onFull} aria-label={full ? "Leave full screen" : "Full screen"} title={full ? "Leave full screen" : "Full screen"}>{full ? <Minimize2 size={14} /> : <Maximize2 size={14} />}</button>
          {state === "closed" && <button className="btn !min-h-[32px]" onClick={() => { setState("connecting"); setAttempt((n) => n + 1); }}><RotateCw size={14} /> Reconnect</button>}
          <button className="btn !min-h-[32px]" onClick={() => void end()} aria-label="End the conversation" title="End the conversation"><Power size={14} /></button>
          <button className="btn !min-h-[32px]" onClick={onHide} aria-label="Hide the terminal" title="Hide; the conversation keeps running"><X size={14} /></button>
        </div>
      </div>
      {!folded && state === "closed" && <p className="border-b border-line px-3 py-1 text-xs text-mute">Disconnected. The conversation keeps running in tmux unless it ended; reconnect to return to it.</p>}
      <div ref={box} className={folded ? "hidden" : "min-h-0 flex-1 p-1"} style={{ background: dark ? DARK.background : LIGHT.background }} />
    </div>
  );
}
