import { chmod, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

/** Where the files live: `$SYNOPTIK_WEB_HOME`, else `~/.synoptik`. DES-0057 D16. */
export const defaultHome = () => process.env.SYNOPTIK_WEB_HOME ?? join(homedir(), ".synoptik");

export type Damage = { file: string; reason: string };

/**
 * One JSON file with a version. A missing file reads as the default. A file that
 * does not parse is reported through `damage` and is never overwritten: every
 * write throws until the file is fixed or deleted (D16).
 */
export class JsonFile<T extends { version: number }> {
  damage: Damage | null = null;
  constructor(readonly dir: string, readonly name: string, private readonly fresh: () => T) {}

  get path() { return join(this.dir, this.name); }

  async read(): Promise<T> {
    try {
      const value = JSON.parse(await readFile(this.path, "utf8")) as T;
      if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error("not an object");
      this.damage = null;
      return value;
    } catch (error: any) {
      if (error?.code === "ENOENT") { this.damage = null; return this.fresh(); }
      this.damage = { file: this.path, reason: String(error?.message ?? error) };
      return this.fresh();
    }
  }

  async write(value: T): Promise<void> {
    if (this.damage) throw new Error(`${this.path} does not parse (${this.damage.reason}); fix or delete it.`);
    await mkdir(this.dir, { recursive: true, mode: 0o700 });
    await chmod(this.dir, 0o700).catch(() => {});
    const temporary = `${this.path}.${process.pid}.tmp`;
    await writeFile(temporary, JSON.stringify(value, null, 2) + "\n", { mode: 0o600 });
    await rename(temporary, this.path);
  }
}

export interface WorkspaceFile { version: 1; roots: string[]; repositories: { path: string; paused: boolean }[] }
export interface UiStateFile { version: 1; [key: string]: unknown }

export class Stores {
  readonly workspace: JsonFile<WorkspaceFile>;
  readonly ui: JsonFile<UiStateFile>;
  constructor(readonly dir: string = defaultHome()) {
    this.workspace = new JsonFile(dir, "web.json", () => ({ version: 1, roots: [], repositories: [] }));
    this.ui = new JsonFile(dir, "ui-state.json", () => ({ version: 1 }));
  }

  /** Apply `change` to the workspace file and write it. */
  async updateWorkspace(change: (value: WorkspaceFile) => void): Promise<WorkspaceFile> {
    const value = await this.workspace.read();
    change(value);
    await this.workspace.write(value);
    return value;
  }
}
