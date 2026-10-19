import { createContext, useContext } from "react";

/** What every component needs to know about the workspace and does not receive as a prop. */
export interface Ws {
  repoNames: string[];
  /** Folder path by repository name, which an agent is launched in. */
  repoPaths: Record<string, string>;
  statuses: string[];
  priorities: string[];
  /**
   * Open the repository's agent terminal beside the document, with MESSAGE as
   * the first thing said (REQ-0080 R23). Absent when no adapter offers one.
   */
  openTerminal?: (repo: string, message: string) => Promise<void>;
}

export const WsContext = createContext<Ws>({ repoNames: [], repoPaths: {}, statuses: [], priorities: [] });
export const useWs = () => useContext(WsContext);
