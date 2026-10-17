import { createContext, useContext } from "react";

/** What every component needs to know about the workspace and does not receive as a prop. */
export interface Ws {
  repoNames: string[];
  statuses: string[];
  priorities: string[];
}

export const WsContext = createContext<Ws>({ repoNames: [], statuses: [], priorities: [] });
export const useWs = () => useContext(WsContext);
