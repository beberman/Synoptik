import { useMemo } from "react";
import { X } from "lucide-react";
import { lineDiff, withContext } from "../diff";

/** What differs between two texts of a document, and a way back to the older one. */
export default function Changes({ title, note, older, newer, canRevert, onRevert, onClose }: {
  title: string; note?: string; older: string; newer: string; canRevert: boolean; onRevert: () => void; onClose: () => void;
}) {
  const shown = useMemo(() => withContext(lineDiff(older, newer)), [older, newer]);
  const changed = shown.some((s) => s.kind === "add" || s.kind === "del");
  return (
    <div className="fixed inset-0 z-[55] flex items-end justify-center bg-black/50 sm:items-center sm:p-6">
      <div className="flex max-h-full w-full max-w-3xl flex-col rounded-t-2xl bg-panel p-4 shadow-xl sm:rounded-2xl">
        <div className="mb-2 flex items-center gap-2"><h3 className="text-lg font-semibold">{title}</h3>
          <button className="btn ml-auto" onClick={onClose} aria-label="Close"><X size={16} /></button></div>
        {note && <p className="mb-2 text-xs text-mute">{note}</p>}
        <div className="min-h-0 flex-1 overflow-auto rounded-lg border border-line font-mono text-xs leading-relaxed">
          {!changed && <p className="p-3 text-mute">No difference.</p>}
          {shown.map((s, i) => s.kind === "skip"
            ? <div key={i} className="bg-line/30 px-3 py-0.5 text-mute">… {s.count} unchanged line{s.count === 1 ? "" : "s"}</div>
            : <div key={i} className={`whitespace-pre-wrap px-3 ${s.kind === "add" ? "bg-emerald-500/15" : s.kind === "del" ? "bg-red-500/15" : ""}`}>
                <span className="mr-2 select-none text-mute">{s.kind === "add" ? "+" : s.kind === "del" ? "−" : " "}</span>{s.text}
              </div>)}
        </div>
        <div className="mt-3 flex justify-end gap-2">
          <button className="btn" onClick={onClose}>Close</button>
          <button className="btn btn-primary" disabled={!canRevert || !changed} onClick={onRevert}
            title={canRevert ? "Write the older text back to the file" : "Save or undo your edits first"}>Go back to the older text</button>
        </div>
      </div>
    </div>
  );
}
