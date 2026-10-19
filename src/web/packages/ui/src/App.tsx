import { useEffect, useMemo, useRef, useState } from "react";
import { Bot, FileText, Filter, GitBranch, LayoutGrid, List, Moon, Network, Plus, SquareTerminal, Sun } from "lucide-react";
import type { Client } from "@synoptik/client";
import Sidebar, { EMPTY } from "./components/Sidebar";
import MapView from "./components/MapView";
import DocCard from "./components/DocCard";
import DocPanel from "./components/DocPanel";
import Agents from "./components/Agents";
import NewDoc from "./components/NewDoc";
import Workspace from "./components/Workspace";
import TerminalPanel, { type OpenTerminal } from "./components/Terminal";
import { WsContext } from "./context";
import { distinct, key, matches, widen } from "./data";
import { loadUiState, useServerEvents, useUiState, useWorkspaceData, type UiState } from "./state";
import type { Doc, Filters } from "./types";

const MAP_LIMIT = 90;
type Panel = "agents" | "workspace" | null;

/**
 * HISTORY ties the browser's back and forward buttons to the view. Off by
 * default: inside a host page (the CloudCLI plugin) the host owns the history.
 */
export default function App({ client, history = false }: { client: Client; history?: boolean }) {
  const { ops, docs, repos, error, loaded, damaged, reload } = useWorkspaceData(client);
  const [saved, setSaved] = useState<UiState | null>(null);
  useEffect(() => { void loadUiState(client).then(setSaved); }, [client]);
  if (!saved || !loaded) return <div className="p-6 text-sm text-mute">Loading…</div>;
  return <Shell client={client} ops={ops} docs={docs} repos={repos} error={error} damaged={damaged} reload={reload} saved={saved} history={history} />;
}

function Shell({ client, ops, docs, repos, error, damaged, reload, saved, history }: {
  client: Client; ops: ReturnType<typeof useWorkspaceData>["ops"]; docs: Doc[]; repos: ReturnType<typeof useWorkspaceData>["repos"];
  error: string | null; damaged: string | null; reload: () => Promise<void>; saved: UiState; history: boolean;
}) {
  const [filters, setFilters] = useState<Filters>(saved.filters ?? { ...EMPTY, types: ["REQ"], widen: 1 });
  const [selected, setSelected] = useState<string | null>(saved.selected ?? null);
  const [recent, setRecent] = useState<string[]>(saved.recent ?? []);
  const [view, setView] = useState<"map" | "list">(saved.view ?? (window.matchMedia("(max-width: 767px)").matches ? "list" : "map"));
  const [showFilters, setShowFilters] = useState(false);
  const [panel, setPanel] = useState<Panel>(null);
  const [showNew, setShowNew] = useState(false);
  const [dark, setDark] = useState(() => saved.dark ?? window.matchMedia("(prefers-color-scheme: dark)").matches);
  const [wide, setWide] = useState(saved.wide ?? false);
  const [message, setMessage] = useState<string | null>(null);
  const [term, setTerm] = useState<OpenTerminal | null>(null);
  const [termShown, setTermShown] = useState(false);
  // A folded section shows only its title lines. The terminal can also take the whole screen.
  const [folded, setFolded] = useState({ panel: false, doc: false, term: false });
  const [termFull, setTermFull] = useState(false);
  const fold = (k: "panel" | "doc" | "term") => setFolded((f) => ({ ...f, [k]: !f[k] }));
  const [terminalAdapter, setTerminalAdapter] = useState<string | null>(null);
  useEffect(() => {
    void (client("GET", "/api/agents") as Promise<unknown> as Promise<{ adapters: { id: string; capabilities: { supported: string[] } }[] }>)
      .then((a) => setTerminalAdapter(a.adapters.find((x) => x.capabilities.supported.includes("terminal"))?.id ?? null))
      .catch(() => setTerminalAdapter(null));
  }, [client]);

  // What the back and forward buttons move between: the document open, the side
  // panel, map or list, and the filters. The first entry is the page itself, so
  // back past it leaves the interface.
  const nav = { selected, panel, view, filters };
  const navKey = JSON.stringify(nav);
  const known = useRef(navKey);
  useEffect(() => {
    if (!history) return;
    window.history.replaceState({ synoptik: nav }, "");
    const back = (e: PopStateEvent) => {
      const s = e.state?.synoptik as typeof nav | undefined;
      if (!s) return;
      known.current = JSON.stringify(s);
      setSelected(s.selected); setPanel(s.panel); setView(s.view); setFilters(s.filters);
    };
    window.addEventListener("popstate", back);
    return () => window.removeEventListener("popstate", back);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [history]);
  useEffect(() => {
    if (!history || navKey === known.current) return;
    const before = JSON.parse(known.current) as typeof nav;
    known.current = navKey;
    // Typing in the search box changes only the text: one entry for the whole
    // search, not one for every letter.
    const typing = JSON.stringify({ ...before, filters: { ...before.filters, text: "" } }) === JSON.stringify({ ...nav, filters: { ...nav.filters, text: "" } });
    if (typing) window.history.replaceState({ synoptik: nav }, "");
    else window.history.pushState({ synoptik: nav }, "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [navKey]);

  // The cards and counts follow what the service has read. A burst of events (a
  // restart indexes everything again) is one reload.
  const reloadTimer = useRef<ReturnType<typeof setTimeout>>();
  const opened = useRef(false);
  useServerEvents(client, (event) => {
    if (event.type === "open") { if (!opened.current) { opened.current = true; return; } }
    else if (event.type !== "document" && event.type !== "reset") return;
    clearTimeout(reloadTimer.current);
    reloadTimer.current = setTimeout(() => { void reload(); }, 1500);
  });

  const home = () => { setSelected(null); setPanel(null); setShowNew(false); setShowFilters(false); };

  useEffect(() => { document.documentElement.classList.toggle("dark", dark); }, [dark]);
  useEffect(() => { if (!message) return; const t = setTimeout(() => setMessage(null), 3500); return () => clearTimeout(t); }, [message]);
  useUiState(client, { filters, view, dark, selected, recent, wide }, true);
  useEffect(() => { if (selected) setRecent((r) => [selected, ...r.filter((k) => k !== selected)].slice(0, 8)); }, [selected]);

  /** Show TERMINAL, the one an adapter answered for. Opening it hides the panel it was opened from. */
  const showTerminal = (t: OpenTerminal) => { setTerm(t); setTermShown(true); setPanel(null); setFolded((f) => ({ ...f, term: false })); };

  const ws = useMemo(() => ({
    repoNames: repos.map((r) => r.name),
    repoPaths: Object.fromEntries(repos.map((r) => [r.name, r.path])),
    statuses: distinct(docs.map((d) => d.status)),
    priorities: distinct(docs.map((d) => d.priority)),
    openTerminal: terminalAdapter ? async (repo: string, text: string) => {
      const path = repos.find((r) => r.name === repo)?.path;
      if (!path) { setMessage(`No folder is known for ${repo}.`); return; }
      try {
        const answer = (await client("POST", `/api/agents/${terminalAdapter}/terminals`, { repository: path, message: text, cols: 120, rows: 36 })) as unknown as
          { terminal: { name: string; repository: string }; started: boolean };
        showTerminal({ adapter: terminalAdapter, name: answer.terminal.name, repository: answer.terminal.repository });
        if (!answer.started && text) setMessage("A conversation is already running there. Your message is typed at its prompt; press Enter to send it.");
      } catch (e: any) { setMessage(e?.message ?? String(e)); }
    } : undefined,
  }), [repos, docs, terminalAdapter, client]);
  const inWorkspace = docs;
  const repoNames = ws.repoNames;

  const { visible, matchedCount } = useMemo(() => {
    const matched = new Set(inWorkspace.filter((d) => matches(d, filters)).map(key));
    const ids = filters.widen ? widen(inWorkspace, matched, filters.widen) : matched;
    return { visible: inWorkspace.filter((d) => ids.has(key(d))), matchedCount: matched.size };
  }, [inWorkspace, filters]);

  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const d of inWorkspace) { c[d.type] = (c[d.type] ?? 0) + 1; c[d.repo] = (c[d.repo] ?? 0) + 1; }
    return c;
  }, [inWorkspace]);

  const doc = inWorkspace.find((d) => key(d) === selected) ?? null;
  const tooBig = view === "map" && visible.length > MAP_LIMIT;
  const multi = new Set(visible.map((d) => d.repo)).size > 1;
  const terminalOpen = !!term && termShown;
  const sidePanel = doc || panel || terminalOpen;
  const full = (wide && !!doc) || (terminalOpen && termFull);

  const sidebar = (onClose?: () => void) => (
    <Sidebar docs={inWorkspace} filters={filters} set={setFilters} counts={counts} repoNames={repoNames} onClose={onClose}
      recent={recent.map((k) => inWorkspace.find((d) => key(d) === k)).filter((d): d is Doc => !!d)} onOpen={setSelected} />
  );

  return (
    <WsContext.Provider value={ws}>
    <div className="flex h-full flex-col">
      <header className="flex items-center gap-1.5 border-b border-line bg-panel px-2 py-2 sm:gap-2 sm:px-3">
        <button className="flex min-h-[44px] items-center gap-2 rounded-lg pr-2 hover:bg-line/40 max-[419px]:min-w-[44px] max-[419px]:justify-center max-[419px]:pr-0 md:min-h-0" onClick={home} aria-label="Synoptik home" title="Back to the home view">
          <FileText size={20} className="ml-1 text-accent" />
          <span className="hidden font-semibold min-[420px]:inline">Synoptik</span>
        </button>
        <span className="flex-1" />
        <button className="btn md:hidden" onClick={() => setShowFilters(true)} aria-label="Filters"><Filter size={16} /></button>
        <button className="btn btn-primary" onClick={() => setShowNew(true)}><Plus size={16} /><span className="hidden sm:inline">New</span></button>
        <button className={`btn ${panel === "workspace" ? "!border-accent text-accent" : ""}`} onClick={() => setPanel(panel === "workspace" ? null : "workspace")} aria-label="Workspace">
          <GitBranch size={16} /><span className="hidden sm:inline">Workspace · {repos.length}</span>
        </button>
        <button className={`btn ${panel === "agents" ? "!border-accent text-accent" : ""}`} onClick={() => setPanel(panel === "agents" ? null : "agents")} aria-label="Agents">
          <Bot size={16} /><span className="hidden sm:inline">Agents</span>
        </button>
        {term && !termShown && (
          <button className="btn" onClick={() => setTermShown(true)} aria-label="Show the terminal" title={`Return to the conversation in ${term.repository.replace(/\/$/, "").split("/").pop()}`}>
            <SquareTerminal size={16} /><span className="hidden sm:inline">Terminal</span>
          </button>
        )}
        <button className="btn" onClick={() => setDark(!dark)} aria-label="Toggle theme">{dark ? <Sun size={16} /> : <Moon size={16} />}</button>
      </header>
      {error && <div role="alert" className="bg-red-500/15 px-3 py-1.5 text-center text-xs font-medium text-red-600 dark:text-red-400">The service did not answer: {error}</div>}
      {damaged && <div role="alert" className="bg-amber-500/20 px-3 py-1.5 text-center text-xs font-medium text-amber-700 dark:text-amber-400">~/.synoptik/web.json does not parse ({damaged}). Workspace changes are not saved until it is fixed or deleted.</div>}

      <div className="flex min-h-0 flex-1">
        <aside className={`hidden w-72 shrink-0 border-r border-line bg-panel ${full ? "" : "md:block"}`}>{sidebar()}</aside>

        <main className={`min-w-0 flex-1 flex-col gap-3 overflow-hidden p-3 ${full ? "hidden" : "flex"}`}>
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className="font-medium">{visible.length} documents</span>
            <span className="text-mute">{matchedCount} match{filters.widen ? `, ${visible.length - matchedCount} connected` : ""}</span>
            <span className="flex-1" />
            <div className="flex overflow-hidden rounded-lg border border-line">
              <button className={`btn !rounded-none !border-0 ${view === "map" ? "!bg-accent/15 text-accent" : ""}`} onClick={() => setView("map")}><Network size={16} /> Map</button>
              <button className={`btn !rounded-none !border-0 ${view === "list" ? "!bg-accent/15 text-accent" : ""}`} onClick={() => setView("list")}><List size={16} /> List</button>
            </div>
          </div>
          <div className="min-h-0 flex-1">
            {repos.length === 0 ? (
              <div className="flex h-full flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-line p-6 text-center">
                <GitBranch className="text-mute" />
                <p className="max-w-sm text-sm text-mute">The workspace has no folders. Add one to see its documents.</p>
                <button className="btn btn-primary" onClick={() => setPanel("workspace")}>Open workspace</button>
              </div>
            ) : tooBig ? (
              <div className="flex h-full flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-line p-6 text-center">
                <LayoutGrid className="text-mute" />
                <p className="max-w-sm text-sm text-mute">{visible.length} documents is too many to draw as a map. Narrow the filters, or use a quick view.</p>
                <button className="btn" onClick={() => setView("list")}>Show as list</button>
              </div>
            ) : view === "map" ? (
              <MapView docs={visible} all={inWorkspace} selectedId={selected} onSelect={setSelected} />
            ) : (
              <div className="grid h-full grid-cols-[minmax(0,1fr)] content-start gap-2 overflow-y-auto sm:grid-cols-[repeat(2,minmax(0,1fr))] xl:grid-cols-[repeat(3,minmax(0,1fr))]">
                {visible.slice(0, 300).map((d) => <DocCard key={key(d)} doc={d} showRepo={multi} selected={key(d) === selected} onClick={() => setSelected(key(d))} />)}
              </div>
            )}
          </div>
        </main>

        {sidePanel && (
          <aside className={`fixed inset-0 z-40 flex min-w-0 flex-col overflow-hidden bg-panel md:static md:z-auto md:border-l md:border-line ${full ? "md:flex-1" : "md:w-[min(46vw,640px)]"}`}>
            {panel && !(terminalOpen && termFull) && (
              <div className={folded.panel ? "shrink-0 border-b border-line" : doc ? "h-1/3 border-b border-line" : terminalOpen ? "h-1/3 border-b border-line" : "h-full"}>
                {panel === "agents"
                  ? <Agents client={client} repos={repos} onClose={() => setPanel(null)} toast={setMessage} onTerminal={showTerminal} folded={folded.panel} onFold={() => fold("panel")} />
                  : <Workspace client={client} repos={repos} counts={counts} reload={reload} onClose={() => setPanel(null)} toast={setMessage} folded={folded.panel} onFold={() => fold("panel")} />}
              </div>
            )}
            {doc && !(terminalOpen && termFull) && (
              <div className={folded.doc ? "shrink-0" : "min-h-0 flex-1"}>
                <DocPanel key={key(doc)} client={client} ops={ops} doc={doc} all={inWorkspace} onClose={() => setSelected(null)} wide={wide} onWide={() => setWide(!wide)} onSelect={setSelected} toast={setMessage} reload={reload} folded={folded.doc} onFold={() => fold("doc")} />
              </div>
            )}
            {terminalOpen && (
              <div className={folded.term ? "shrink-0 border-t border-line" : termFull ? "min-h-0 flex-1" : doc ? "h-1/2 min-h-[240px] border-t border-line" : "min-h-0 flex-1"}>
                <TerminalPanel key={`${term!.adapter}/${term!.name}`} client={client} term={term!} dark={dark}
                  onHide={() => { setTermShown(false); setTermFull(false); }} onEnded={() => { setTerm(null); setTermShown(false); setTermFull(false); }} toast={setMessage}
                  folded={folded.term} onFold={() => fold("term")} full={termFull} onFull={() => setTermFull(!termFull)} />
              </div>
            )}
          </aside>
        )}
      </div>

      {showFilters && <div className="fixed inset-0 z-50 bg-panel md:hidden">{sidebar(() => setShowFilters(false))}</div>}
      {showNew && <NewDoc ops={ops} all={inWorkspace} repoNames={repoNames} defaultRepo={doc?.repo ?? filters.repos[0]} onClose={() => setShowNew(false)}
        onCreated={async (repo, id, address) => { setShowNew(false); await reload(); setSelected(`${repo}/${id}`); setMessage(`Created ${id} in ${repo} at ${address}.`); }} />}
      {message && <div className="fixed bottom-4 left-1/2 z-[60] -translate-x-1/2 rounded-lg bg-ink px-4 py-2 text-sm text-bg shadow-lg">{message}</div>}
    </div>
      </WsContext.Provider>
  );
}
