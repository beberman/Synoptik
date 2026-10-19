import { useState } from "react";
import { KeyRound, X } from "lucide-react";

/** The key the standalone page reads its bearer token from (apps/standalone/src/main.tsx). */
export const TOKEN_KEY = "synoptik-token";

/**
 * Shown when the server answers 401. The banner is the way in: clicking it opens
 * a box for the token. The token is kept in this browser's storage and the page
 * is read again, because the client was built with the token it started with.
 */
export default function TokenBanner({ message }: { message: string }) {
  const [open, setOpen] = useState(false);
  const [token, setToken] = useState("");
  const [problem, setProblem] = useState<string | null>(null);

  const save = () => {
    const value = token.trim();
    if (!value) { setProblem("Type the token first."); return; }
    try { localStorage.setItem(TOKEN_KEY, value); } catch {
      setProblem("This browser would not keep it. Open the address with #token=… on the end instead.");
      return;
    }
    location.reload();
  };

  return (
    <div className="relative">
      <button role="alert" onClick={() => setOpen(!open)} aria-expanded={open} aria-haspopup="dialog"
        className="flex min-h-[44px] w-full items-center justify-center gap-2 bg-red-500/15 px-3 py-1.5 text-center text-xs font-medium text-red-600 hover:bg-red-500/25 md:min-h-[32px] dark:text-red-400">
        <KeyRound size={14} /> {message} <span className="underline">Add token</span>
      </button>
      {open && (
        <div role="dialog" aria-label="Add the bearer token"
          className="absolute left-1/2 top-full z-[60] mt-1 w-[min(24rem,calc(100vw-2rem))] -translate-x-1/2 rounded-xl border border-line bg-panel p-3 shadow-xl">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-sm font-semibold">Bearer token</span>
            <button className="btn" onClick={() => setOpen(false)} aria-label="Close"><X size={16} /></button>
          </div>
          <form onSubmit={(e) => { e.preventDefault(); save(); }} className="space-y-2">
            <input className="input font-mono" type="password" autoFocus autoComplete="off" spellCheck={false}
              placeholder="Paste the token" aria-label="Bearer token"
              value={token} onChange={(e) => { setToken(e.target.value); setProblem(null); }} />
            {problem && <p role="alert" className="text-xs text-red-600 dark:text-red-400">{problem}</p>}
            <p className="text-xs text-mute">Kept in this browser only. Clear the site's data to forget it.</p>
            <button className="btn btn-primary w-full" type="submit">Save and reload</button>
          </form>
        </div>
      )}
    </div>
  );
}
