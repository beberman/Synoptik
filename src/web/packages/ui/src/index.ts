import { createRoot, type Root } from "react-dom/client";
import { createElement } from "react";
import type { Client } from "@synoptik/client";
import App from "./App";

export { App };

/** Render the interface into CONTAINER, talking to the service through CLIENT. */
export function mountStandalone(container: HTMLElement, client: Client): Root {
  const root = createRoot(container);
  root.render(createElement(App, { client }));
  return root;
}
