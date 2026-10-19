#!/usr/bin/env node
// The agent host (PLAN-0062 S19, DES-0057 D20). Run it on the machine that has
// the repositories.
//
//   SYNOPTIK_HOST_TOKEN          required: the bearer token every request needs
//   SYNOPTIK_HOST_REPOS          required: the repositories agents may run in,
//                                separated by `:`; each must be a git repository
//   SYNOPTIK_HOST_ADDRESS        the address to bind        default 127.0.0.1
//   SYNOPTIK_HOST_PORT           the port                   default 4795
//   SYNOPTIK_HOST_CLAUDE         the program to run         default claude
//   SYNOPTIK_HOST_ALLOWED_TOOLS  what an agent may use      default read, edit, tools/synoptik.sh
//   SYNOPTIK_HOST_BUDGET_USD     the most one run may cost  default 2
//   SYNOPTIK_HOST_TERMINALS      `off` offers no terminals  default on when tmux
//                                and python3 are on PATH (DES-0057 D21)
//
// The model credentials are the environment's and the tool's own login. This
// program never reads them.
import { existsSync, realpathSync } from "node:fs";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { ClaudeRunner, DEFAULT_TOOLS, loginReader } from "./claude.js";
import { createHostHandler } from "./host.js";
import { Tmux } from "./terminal.js";
import { listen } from "./listener.js";

const fail = (message: string): never => { console.error(message); process.exit(1); };

const token = process.env.SYNOPTIK_HOST_TOKEN;
if (!token) fail("SYNOPTIK_HOST_TOKEN is not set. The host answers no request without a token.");
const listed = (process.env.SYNOPTIK_HOST_REPOS ?? "").split(":").filter(Boolean);
if (listed.length === 0) fail("SYNOPTIK_HOST_REPOS names no repository. Give the folders agents may run in, separated by `:`.");
const repositories = listed.map((path) => {
  let real: string;
  try { real = realpathSync(path); } catch { return fail(`${path} does not exist on this machine.`); }
  if (!existsSync(join(real, ".git"))) fail(`${real} is not a git repository.`);
  return real;
});
const budget = Number(process.env.SYNOPTIK_HOST_BUDGET_USD ?? 2);
if (!(budget > 0)) fail("SYNOPTIK_HOST_BUDGET_USD must be a positive number.");

const onPath = (program: string) => { try { execFileSync("sh", ["-c", `command -v ${program}`], { stdio: "ignore" }); return true; } catch { return false; } };
const claude = process.env.SYNOPTIK_HOST_CLAUDE ?? "claude";
const terminals = process.env.SYNOPTIK_HOST_TERMINALS !== "off" && onPath("tmux") && onPath("python3");

const address = process.env.SYNOPTIK_HOST_ADDRESS ?? "127.0.0.1";
const port = Number(process.env.SYNOPTIK_HOST_PORT ?? 4795);
const handler = createHostHandler({
  token: token!, repositories,
  runner: new ClaudeRunner({
    command: claude,
    allowedTools: process.env.SYNOPTIK_HOST_ALLOWED_TOOLS ?? DEFAULT_TOOLS,
    maxBudgetUsd: budget,
  }),
  login: loginReader(claude),
  ...(terminals ? { terminals: { mux: new Tmux(), command: [claude] } } : {}),
});
try {
  const server = await listen(address, port, handler);
  console.log(`synoptik-agent-host listening on http://${address}:${port}/ for ${repositories.join(", ")}${terminals ? ", with terminals" : ", without terminals (tmux or python3 missing, or SYNOPTIK_HOST_TERMINALS=off)"}`);
  if (address !== "127.0.0.1" && address !== "::1" && address !== "localhost") console.log("note: this address is not loopback; the token travels in the clear unless something in front adds TLS.");
  for (const sig of ["SIGTERM", "SIGINT"] as const) process.on(sig, () => server.close(() => process.exit(0)));
} catch (error: any) { fail(error.message); }
