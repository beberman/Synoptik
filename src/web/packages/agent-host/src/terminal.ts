import { execFile, spawn, type ChildProcess } from "node:child_process";
import { createHash } from "node:crypto";
import { basename } from "node:path";
import { fileURLToPath } from "node:url";

// The terminal of DES-0057 D21: Claude Code inside tmux, one session per
// repository, reached through a pseudo-terminal the Python bridge provides.

export interface TerminalInfo {
  /** The tmux session name, which is also the terminal's id. */
  name: string;
  /** The repository's real path. */
  repository: string;
  /** ISO time the session was created. */
  since: string;
  /** How many clients are attached: the page, an ordinary terminal, or both. */
  attached: number;
}

/** One attached client: bytes in, bytes out, a size, an end. */
export interface Attachment {
  write(data: Buffer): void;
  resize(cols: number, rows: number): void;
  onData(listener: (data: Buffer) => void): void;
  onExit(listener: () => void): void;
  /** Detach. The session keeps running. */
  close(): void;
}

/** What the host needs from tmux. A test gives a fake. */
export interface Multiplexer {
  /** The live sessions whose names start with `synoptik-`, with the directory each started in. */
  list(): Promise<{ name: string; path: string; created: number; attached: number }[]>;
  start(o: { name: string; cwd: string; command: string[]; cols: number; rows: number }): Promise<void>;
  /** Type TEXT at the session's prompt, without Enter. */
  type(name: string, text: string): Promise<void>;
  close(name: string): Promise<void>;
  attach(name: string, cols: number, rows: number): Attachment;
}

/** The tmux session name for a repository: readable, and unique per real path. */
export function terminalName(repository: string): string {
  const folder = basename(repository).replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 40) || "repo";
  return `synoptik-${folder}-${createHash("sha256").update(repository).digest("hex").slice(0, 8)}`;
}

const BRIDGE = fileURLToPath(new URL("../bridge/pty-bridge.py", import.meta.url));

function run(command: string, args: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    execFile(command, args, { encoding: "utf8" }, (error, stdout, stderr) =>
      resolve({ code: error ? (typeof (error as any).code === "number" ? (error as any).code : 1) : 0, stdout, stderr }));
  });
}

/**
 * The person's own tmux server, so `tmux attach -t <name>` in an ordinary
 * terminal reaches the session the page shows.
 */
export class Tmux implements Multiplexer {
  constructor(private readonly config: { tmux?: string; python?: string } = {}) {}
  private get tmux() { return this.config.tmux ?? "tmux"; }

  async list() {
    const r = await run(this.tmux, ["list-sessions", "-F", "#{session_name}\t#{session_path}\t#{session_created}\t#{session_attached}"]);
    // No server running is no sessions, not a failure.
    if (r.code !== 0) return [];
    return r.stdout.split("\n").filter((l) => l.startsWith("synoptik-")).map((line) => {
      const [name, path, created, attached] = line.split("\t");
      return { name: name!, path: path ?? "", created: Number(created) * 1000, attached: Number(attached) || 0 };
    });
  }

  async start(o: { name: string; cwd: string; command: string[]; cols: number; rows: number }) {
    const r = await run(this.tmux, ["new-session", "-d", "-s", o.name, "-c", o.cwd, "-x", String(o.cols), "-y", String(o.rows), ...o.command]);
    if (r.code !== 0) throw new Error(`tmux could not start the session: ${r.stderr.trim() || `exit ${r.code}`}`);
    // The page has no use for tmux's status line, and it would take a row.
    // set-option takes a pane target, so the exact-match form needs the colon.
    await run(this.tmux, ["set-option", "-t", `=${o.name}:`, "status", "off"]);
  }

  async type(name: string, text: string) {
    await run(this.tmux, ["send-keys", "-t", `=${name}:`, "-l", "--", text]);
  }

  async close(name: string) {
    await run(this.tmux, ["kill-session", "-t", `=${name}`]);
  }

  attach(name: string, cols: number, rows: number): Attachment {
    const child: ChildProcess = spawn(this.config.python ?? "python3", [BRIDGE, "--size", `${cols}x${rows}`, "--", this.tmux, "attach-session", "-t", `=${name}`], {
      stdio: ["pipe", "pipe", "ignore", "pipe"],
      env: { ...process.env, TERM: "xterm-256color" },
    });
    const control = child.stdio[3] as NodeJS.WritableStream;
    return {
      write: (data) => { child.stdin?.write(data); },
      resize: (c, r) => { control.write(`${c}x${r}\n`); },
      onData: (listener) => { child.stdout?.on("data", listener); },
      onExit: (listener) => { child.on("close", listener); },
      close: () => { child.stdin?.end(); setTimeout(() => child.kill("SIGTERM"), 2000).unref(); },
    };
  }
}
