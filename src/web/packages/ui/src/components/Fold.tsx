import { ChevronDown, ChevronRight } from "lucide-react";

/** Shrinks a section to its title lines, or grows it back. */
export default function Fold({ folded, onFold }: { folded: boolean; onFold: () => void }) {
  const label = folded ? "Expand this section" : "Shrink this section to its title";
  return <button className="btn !min-h-[44px] md:!min-h-[32px]" onClick={onFold} aria-label={label} aria-expanded={!folded} title={label}>{folded ? <ChevronRight size={14} /> : <ChevronDown size={14} />}</button>;
}
