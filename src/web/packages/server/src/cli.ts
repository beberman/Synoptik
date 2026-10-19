#!/usr/bin/env node
// The standalone listener (PLAN-0062 S8): `createHandler` behind a port, plus
// the build of apps/standalone. Configuration is from the environment so a unit
// file or tools/synoptik-ui.sh sets it without arguments.
//
//   SYNOPTIK_URL        the service            default http://127.0.0.1:4780
//   SYNOPTIK_UI_HOST    the address to bind    default 127.0.0.1
//   SYNOPTIK_UI_PORT    the port               default 4790
//   SYNOPTIK_UI_TOKEN   bearer token; required for any non-loopback host
//   SYNOPTIK_UI_STATIC  the directory served   default apps/standalone/dist
//   SYNOPTIK_WEB_HOME   where web.json lives   default ~/.synoptik
//   SYNOPTIK_CLOUDCLI_URL / _TOKEN / _API_KEY   turn on the CloudCLI agent adapter
//   SYNOPTIK_AGENT_HOST_URL / _TOKEN            turn on the agent host adapter (DES-0057 D20)
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { createHandler, restoreWorkspace } from "./handler.js";
import { startListener } from "./listener.js";
import { CloudCliAdapter, HostAdapter, NativeAdapter, type AgentController } from "@synoptik/agents";
import { Stores } from "./store.js";
import { ChangeFeed } from "./changes.js";

const here = dirname(fileURLToPath(import.meta.url));
const serviceUrl = process.env.SYNOPTIK_URL ?? "http://127.0.0.1:4780";
const host = process.env.SYNOPTIK_UI_HOST ?? "127.0.0.1";
const port = Number(process.env.SYNOPTIK_UI_PORT ?? 4790);
const token = process.env.SYNOPTIK_UI_TOKEN || undefined;
const staticDir = resolve(process.env.SYNOPTIK_UI_STATIC ?? resolve(here, "../../../apps/standalone/dist"));

const stores = new Stores();
const feed = new ChangeFeed({ serviceUrl });
const adapters: AgentController[] = [new NativeAdapter()];
if (process.env.SYNOPTIK_CLOUDCLI_URL) {
  adapters.push(new CloudCliAdapter({
    baseUrl: process.env.SYNOPTIK_CLOUDCLI_URL,
    token: process.env.SYNOPTIK_CLOUDCLI_TOKEN || undefined,
    apiKey: process.env.SYNOPTIK_CLOUDCLI_API_KEY || undefined,
  }));
}
if (process.env.SYNOPTIK_AGENT_HOST_URL) {
  const hostToken = process.env.SYNOPTIK_AGENT_HOST_TOKEN;
  if (!hostToken) { console.error("SYNOPTIK_AGENT_HOST_URL is set without SYNOPTIK_AGENT_HOST_TOKEN."); process.exit(1); }
  adapters.push(new HostAdapter({ baseUrl: process.env.SYNOPTIK_AGENT_HOST_URL, token: hostToken }));
}
try {
  const server = await startListener({ host, port, token, staticDir, handler: createHandler({ serviceUrl, token, stores, adapters, subscribe: (listener) => feed.subscribe(listener) }) });
  console.log(`synoptik-ui listening on http://${host}:${port}/ for ${serviceUrl}${token ? " (token required)" : ""}`);
  for (const sig of ["SIGTERM", "SIGINT"] as const) process.on(sig, () => server.close(() => process.exit(0)));
} catch (error: any) {
  console.error(error.message);
  process.exit(1);
}

// The service may start after this does, so replay until it answers, then stop.
for (let attempt = 0; attempt < 30; attempt++) {
  const report = await restoreWorkspace({ serviceUrl, stores });
  const failed = report.filter((r) => r.state === "failed");
  for (const r of report) if (r.state !== "watched") console.log(`workspace: ${r.path} ${r.state}${r.message ? `: ${r.message}` : ""}`);
  if (failed.length === 0) break;
  await new Promise((r) => setTimeout(r, 2000));
}
