import { useEffect, useRef, useState } from "react";
import { ArrowRight, ChevronDown, ChevronRight } from "lucide-react";
import type { Described, operations } from "@synoptik/client";

type Shown = { state: "loading" } | { state: "found"; found: Described } | { state: "none"; why: string };

/** The definition a name stands for, as the service holds it. Fetched when first shown. */
export function Definition({ ops, repo, name }: { ops: ReturnType<typeof operations>; repo: string; name: string }) {
  const [shown, setShown] = useState<Shown>({ state: "loading" });
  useEffect(() => {
    let live = true;
    ops.describe(repo, name)
      .then((found) => live && setShown({ state: "found", found }))
      .catch((e: any) => live && setShown({ state: "none", why: e?.message ?? String(e) }));
    return () => { live = false; };
  }, [ops, repo, name]);

  const found = shown.state === "found" ? shown.found : null;
  const text = found?.source?.text;
  return (
    <div className="border-t border-line px-2 py-2 text-xs">
      {shown.state === "loading" && <p className="text-mute">Loading…</p>}
      {shown.state === "none" && <p role="alert" className="text-amber-700 dark:text-amber-400">{shown.why}</p>}
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
  );
}

/**
 * One name from an `affects:` list that is not a document. Opening it shows the
 * definition. A name the index has no entity for says so and shows nothing.
 */
export default function AffectedCode({ ops, repo, name, reveal }: { ops: ReturnType<typeof operations>; repo: string; name: string; reveal?: { name: string; n: number } | null }) {
  const [open, setOpen] = useState(false);
  const row = useRef<HTMLDivElement>(null);
  // Opened from outside: a click on the name in the check_document column.
  useEffect(() => {
    if (reveal?.name !== name) return;
    setOpen(true);
    row.current?.scrollIntoView({ block: "nearest" });
  }, [reveal, name]);
  return (
    <div ref={row} className="rounded-lg bg-line/30">
      <button className="flex min-h-[44px] w-full items-center gap-2 px-2 py-1.5 text-left font-mono text-xs md:min-h-[32px]"
        onClick={() => setOpen(!open)} aria-expanded={open} title={open ? "Hide the definition" : "Show the definition"}>
        <ArrowRight size={12} className="shrink-0" /> <span className="min-w-0 flex-1 break-all">{name}</span>
        {open ? <ChevronDown size={14} className="shrink-0" /> : <ChevronRight size={14} className="shrink-0" />}
      </button>
      {open && <Definition ops={ops} repo={repo} name={name} />}
    </div>
  );
}
