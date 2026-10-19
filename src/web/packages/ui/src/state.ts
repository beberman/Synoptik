import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { operations, type Client, type ServerEvent } from "@synoptik/client";
import { toDoc } from "./data";
import type { Doc, Filters, Repo } from "./types";

interface StatusRow { name: string; root: string; state: string; commit: string | null; documents: number }
interface WorkspaceRow { path: string; paused: boolean; missing: boolean }

const basename = (path: string) => path.replace(/\/$/, "").split("/").pop() ?? path;

/**
 * The documents and repositories the service holds, and the workspace file's
 * view of them. Reloaded every ten seconds and when the page is shown again, so
 * an edit made in a text editor or by an agent appears without a refresh.
 */
export function useWorkspaceData(client: Client) {
  const ops = useMemo(() => operations(client), [client]);
  const [docs, setDocs] = useState<Doc[]>([]);
  const [repos, setRepos] = useState<Repo[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [damaged, setDamaged] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      const [lists, status, workspace] = await Promise.all([
        ops.documents(),
        client("GET", "/api/v1/status") as Promise<unknown> as Promise<{ repositories: StatusRow[] }>,
        client("GET", "/api/workspace") as Promise<unknown> as Promise<{ repositories: WorkspaceRow[]; damaged: { reason: string } | null }>,
      ]);
      setDocs(lists.flatMap((l) => l.documents.map((row) => toDoc(l.repository, row))));
      const paused = new Map(workspace.repositories.map((r) => [r.path.replace(/\/$/, ""), r]));
      const known = new Set<string>();
      const live: Repo[] = status.repositories.map((r) => {
        const path = r.root.replace(/\/$/, "");
        known.add(path);
        const remembered = paused.get(path);
        const state: Repo["state"] = remembered?.paused || r.state === "paused" ? "paused" : r.state === "ready" ? "ready" : "indexing";
        return { name: r.name, path, commit: (r.commit ?? "").slice(0, 7), documents: r.documents, state };
      });
      const absent: Repo[] = workspace.repositories
        .filter((r) => !known.has(r.path.replace(/\/$/, "")))
        .map((r) => ({ name: basename(r.path), path: r.path, commit: "", documents: 0, state: "paused" as const, missing: r.missing }));
      setRepos([...live, ...absent]);
      setDamaged(workspace.damaged?.reason ?? null);
      setError(null);
    } catch (e: any) {
      setError(e?.message ?? String(e));
    } finally {
      setLoaded(true);
    }
  }, [client, ops]);

  useEffect(() => {
    void reload();
    const timer = setInterval(() => void reload(), 10000);
    const onVisible = () => { if (document.visibilityState === "visible") void reload(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => { clearInterval(timer); document.removeEventListener("visibilitychange", onVisible); };
  }, [reload]);

  return { ops, docs, repos, error, loaded, damaged, reload };
}

export interface UiState {
  filters?: Filters;
  view?: "map" | "list";
  dark?: boolean;
  selected?: string | null;
  recent?: string[];
  wide?: boolean;
}

/** Interface state kept on the server (DES-0057 D17), so a phone and a desktop agree. */
export function useUiState(client: Client, value: UiState, enabled: boolean) {
  const first = useRef(true);
  useEffect(() => {
    if (!enabled) return;
    if (first.current) { first.current = false; return; }
    const timer = setTimeout(() => { void client("PUT", "/api/ui-state", value as never).catch(() => {}); }, 500);
    return () => clearTimeout(timer);
  }, [client, JSON.stringify(value), enabled]);
}

export async function loadUiState(client: Client): Promise<UiState> {
  try { return ((await client("GET", "/api/ui-state")) ?? {}) as UiState; } catch { return {}; }
}

/**
 * Call ON for each event the server pushes. True while the connection is up, so a
 * caller that polls as a fallback can stop while it is. A client that cannot
 * stream is never live.
 */
export function useServerEvents(client: Client, on: (event: ServerEvent) => void): boolean {
  const latest = useRef(on);
  latest.current = on;
  const [live, setLive] = useState(false);
  useEffect(() => {
    if (!client.subscribe) return;
    return client.subscribe((event) => {
      if (event.type === "open") setLive(true);
      else if (event.type === "closed") setLive(false);
      latest.current(event);
    });
  }, [client]);
  return live;
}
