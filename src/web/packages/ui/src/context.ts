import { createContext, useContext } from "react";

/** What every component needs to know about the workspace and does not receive as a prop. */
export interface Ws {
  repoNames: string[];
  /** Folder path by repository name, which an agent is launched in. */
  repoPaths: Record<string, string>;
  statuses: string[];
  priorities: string[];
}

export const WsContext = createContext<Ws>({ repoNames: [], repoPaths: {}, statuses: [], priorities: [] });
export const useWs = () => useContext(WsContext);
