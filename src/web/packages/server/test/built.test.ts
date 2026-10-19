import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// Vitest resolves modules its own way, so a circular import that Node refuses
// passes there. The built packages are loaded by Node itself here, which is how
// tools/synoptik-ui.sh runs them.
const packages = ["client", "agents", "server"].map((p) => join(__dirname, "../..", p, "dist/index.js"));

describe.skipIf(!packages.every(existsSync))("the built packages", () => {
  it.each(packages)("%s loads under node", (entry) => {
    const out = execFileSync("node", ["--input-type=module", "-e", `const m = await import(${JSON.stringify(entry)}); console.log(Object.keys(m).length)`]);
    expect(Number(out.toString())).toBeGreaterThan(0);
  });
});
