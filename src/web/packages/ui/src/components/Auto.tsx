import { useEffect, useLayoutEffect, useRef } from "react";

/** A text box that grows to hold its text. */
export default function Auto({ value, onChange, className, inputRef, onKeyDown }: {
  value: string; onChange: (v: string) => void; className?: string;
  inputRef?: (el: HTMLTextAreaElement | null) => void; onKeyDown?: (e: React.KeyboardEvent<HTMLTextAreaElement>) => void;
}) {
  const ref = useRef<HTMLTextAreaElement | null>(null);
  const fit = () => { const el = ref.current; if (el) { el.style.height = "0"; el.style.height = el.scrollHeight + "px"; } };
  useLayoutEffect(fit, [value]);
  // The box is first measured before the panel has its final width, which leaves it
  // the wrong height until something else makes it measure again.
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    let width = el.clientWidth;
    const watch = new ResizeObserver(() => { if (el.clientWidth !== width) { width = el.clientWidth; fit(); } });
    watch.observe(el);
    void document.fonts?.ready.then(fit);
    return () => watch.disconnect();
  }, []);
  return <textarea ref={(el) => { ref.current = el; inputRef?.(el); }} rows={1} value={value} onChange={(e) => onChange(e.target.value)} onKeyDown={onKeyDown}
    className={`min-h-[44px] w-full resize-none rounded-md border border-transparent bg-transparent px-2 py-2.5 outline-none md:min-h-0 md:py-1 hover:border-line focus:border-accent ${className ?? ""}`} />;
}
