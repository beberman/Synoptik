import { useState } from "react";
import { ArrowRight, ChevronDown, ChevronRight } from "lucide-react";
import type { Described, operations } from "@synoptik/client";

type Shown = { state: "loading" } | { state: "found"; found: Described } | { state: "none"; why: string };

/**
 * One name from an `affects:` list that is not a document. Opening it asks the
 * service for the definition, which it already holds, and shows its text where
 * it is. A name the index has no entity for says so and shows nothing.
 */
export default function AffectedCode({ ops, repo, name }: { ops: ReturnType<typeof operations>; repo: string; name: string }) {
  const [open, setOpen] = useState(false);
  const [shown, setShown] = useState<Shown | null>(null);

  const toggle = () => {
    const next = !open;
    setOpen(next);
    if (!next || shown?.state === "found") return;
    setShown({ state: "loading" });
    ops.describe(repo, name)
      .then((found) => setShown({ state: "found", found }))
      .catch((e: any) => setShown({ state: "none", why: e?.message ?? String(e) }));
  };

  const found = shown?.state === "found" ? shown.found : null;
  const text = found?.source?.text;
  return (
    <div className="rounded-lg bg-line/30">
      <button className="flex min-h-[44px] w-full items-center gap-2 px-2 py-1.5 text-left font-mono text-xs md:min-h-[32px]"
        onClick={toggle} aria-expanded={open} title={open ? "Hide the definition" : "Show the definition"}>
        <ArrowRight size={12} className="shrink-0" /> <span className="min-w-0 flex-1 break-all">{name}</span>
        {open ? <ChevronDown size={14} className="shrink-0" /> : <ChevronRight size={14} className="shrink-0" />}
      </button>
      {open && (
        <div className="border-t border-line px-2 py-2 text-xs">
          {shown?.state === "loading" && <p className="text-mute">Loading…</p>}
          {shown?.state === "none" && <p role="alert" className="text-amber-700 dark:text-amber-400">{shown.why}</p>}
          {found && (
            <>
              <div className="mb-1 font-mono text-mute">{found.entity.type} · {found.entity.location ?? found.source?.file}</div>
              {found.signature && <div className="mb-1 font-mono font-semibold">{found.signature}</div>}
              {found.summary && <p className="mb-2">{found.summary}</p>}
              {text
                ? <pre className="max-h-80 overflow-auto whitespace-pre rounded-lg bg-panel p-2 font-mono text-[11px] leading-snug">{text}</pre>
                : <p className="text-mute">No definition text: the file's source is {found.source?.status ?? "not read"}.</p>}
            </>
          )}
        </div>
      )}
    </div>
  );
}
