import { execFileSync } from "node:child_process";
import { readFileSync, mkdirSync } from "node:fs";
import { build } from "esbuild";
mkdirSync("dist", { recursive: true });
execFileSync("node", ["node_modules/tailwindcss/lib/cli.js", "-c", "tailwind.config.cjs", "-i", "src/tw.css", "-o", "dist/tw.css"], { stdio: "inherit" });
await build({ entryPoints: ["src/index.jsx"], bundle: true, format: "esm", outfile: "dist/index.js", jsx: "automatic",
  define: { "process.env.NODE_ENV": '"production"' }, loader: { ".css": "text" }, alias: { "tw-css": "./dist/tw.css" } });
