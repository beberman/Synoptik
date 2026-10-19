import { fetchClient } from "@synoptik/client";
import { mountStandalone } from "@synoptik/ui";
import "@synoptik/ui/src/index.css";

// A server started with a token needs it on every request. The token is given
// once in the address (#token=...) and kept in this browser's storage.
const fromHash = /token=([^&]+)/.exec(location.hash)?.[1];
try {
  if (fromHash) { localStorage.setItem("synoptik-token", decodeURIComponent(fromHash)); history.replaceState(null, "", location.pathname + location.search); }
} catch { /* storage unavailable: the token is used for this page load only */ }
let token: string | undefined = fromHash ? decodeURIComponent(fromHash) : undefined;
try { token ??= localStorage.getItem("synoptik-token") ?? undefined; } catch { /* ignore */ }

mountStandalone(document.getElementById("root")!, fetchClient({ token }));
