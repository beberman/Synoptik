import { spawn } from "node:child_process";
import type { Outcome, RunHooks, Runner, RunningAgent } from "./types.js";

export interface ClaudeRunnerConfig {
  /** The program to run. `claude`, found on PATH. */
  command?: string;
  /** Arguments before the ones this adds; a test puts a script here. */
  prefixArgs?: string[];
  /** Tools the agent may use, in the tool's own syntax. */
  allowedTools?: string;
  /** Stop the run when it has cost this much, in US dollars. */
  maxBudgetUsd?: number;
  permissionMode?: "acceptEdits" | "plan" | "default";
  /** Seconds between asking a run to stop and killing it. */
  killAfter?: number;
}

export const DEFAULT_TOOLS = "Read Grep Glob Edit Write Bash(tools/synoptik.sh *)";

/**
 * Claude Code, run headless: `claude -p <task>` with its progress as one JSON
 * object a line. It reads credentials from its own login and from the
 * environment, which is this process's and is passed on whole. Nothing here
 * reads, logs or returns a credential.
 *
 * `--permission-prompts none` means an action that would ask is refused, not
 * waited for: nobody here can answer, and a run waiting for an answer that
 * cannot come would hold its repository for ever.
 */
export class ClaudeRunner implements Runner {
  constructor(private readonly config: ClaudeRunnerConfig = {}) {}

  start(request: { cwd: string; task: string }, hooks: RunHooks): RunningAgent {
    const c = this.config;
    const args = [
      ...(c.prefixArgs ?? []),
      "-p", "--output-format", "stream-json", "--verbose",
      "--permission-mode", c.permissionMode ?? "acceptEdits",
      "--permission-prompts", "none",
      "--max-budget-usd", String(c.maxBudgetUsd ?? 2),
      "--allowed-tools", c.allowedTools ?? DEFAULT_TOOLS,
      // After `--`, so a task that starts with a dash is a task and not an option,
      // and the list of tools above cannot take it for another tool.
      "--", request.task,
    ];
    const child = spawn(c.command ?? "claude", args, { cwd: request.cwd, env: process.env, stdio: ["ignore", "pipe", "pipe"] });
    let stopped = false;
    let result: { isError: boolean; text: string } | null = null;
    let stderr = "";
    let spawnError: Error | null = null;

    let pending = "";
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      pending += chunk;
      for (let end = pending.indexOf("\n"); end >= 0; end = pending.indexOf("\n")) {
        const line = pending.slice(0, end).trim();
        pending = pending.slice(end + 1);
        if (line) read(line);
      }
    });
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => { stderr = (stderr + chunk).slice(-2000); });

    const read = (line: string) => {
      let event: any;
      try { event = JSON.parse(line); } catch { return; }
      if (event.type === "assistant") {
        const text = (event.message?.content ?? [])
          .map((part: any) => (part.type === "text" ? part.text : part.type === "tool_use" ? `${part.name} ${briefInput(part.input)}` : ""))
          .filter(Boolean).join(" ").trim();
        if (text) hooks.output(text.slice(0, 400));
      } else if (event.type === "result") {
        result = { isError: Boolean(event.is_error) || (event.subtype !== undefined && event.subtype !== "success"), text: String(event.result ?? event.subtype ?? "") };
      }
    };

    const finished = new Promise<Outcome>((resolve) => {
      child.on("error", (error) => { spawnError = error; });
      child.on("close", (code) => {
        if (stopped) return resolve({ ok: false, stopped: true });
        if (spawnError) return resolve({ ok: false, stopped: false, message: `${c.command ?? "claude"} could not be started: ${spawnError.message}` });
        if (result && !result.isError && code === 0) return resolve({ ok: true, stopped: false });
        resolve({ ok: false, stopped: false, message: (result?.text || stderr.trim() || `the process exited with ${code}`).slice(0, 1000) });
      });
    });

    return {
      finished,
      stop() {
        if (stopped) return;
        stopped = true;
        child.kill("SIGTERM");
        const timer = setTimeout(() => child.kill("SIGKILL"), (c.killAfter ?? 5) * 1000);
        child.on("close", () => clearTimeout(timer));
      },
    };
  }
}

function briefInput(input: unknown): string {
  if (!input || typeof input !== "object") return "";
  const o = input as Record<string, unknown>;
  const value = o.file_path ?? o.path ?? o.pattern ?? o.command ?? "";
  return typeof value === "string" ? value.slice(0, 120) : "";
}
