import { readdir, stat } from "node:fs/promises";
import { join } from "node:path";

export interface Folder { name: string; path: string; git: boolean }

/** The directories one level under each root, each marked as a git repository or not. */
export async function listFolders(roots: string[]): Promise<Folder[]> {
  const found: Folder[] = [];
  for (const root of roots) {
    let names: string[];
    try { names = await readdir(root); } catch { continue; }
    for (const name of names.sort()) {
      if (name.startsWith(".")) continue;
      const path = join(root, name);
      try {
        if (!(await stat(path)).isDirectory()) continue;
      } catch { continue; }
      const git = await stat(join(path, ".git")).then(() => true, () => false);
      found.push({ name, path, git });
    }
  }
  return found;
}

export const exists = (path: string) => stat(path).then((s) => s.isDirectory(), () => false);
