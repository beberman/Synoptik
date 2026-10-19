// PLAN-0062 S1: does Tailwind 3 or 4, adopted as a constructed stylesheet into a
// shadow root, give the sizes and effects the components rely on?
import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { chromium } from "playwright-core";

const files = { "/probe.js": ["out/probe.js", "text/javascript"], "/tw3.css": ["out/tw3.css", "text/css"], "/tw4.css": ["out/tw4.css", "text/css"], "/tw3px.css": ["out/tw3px.css", "text/css"] };
const server = createServer((req, res) => {
  const f = files[req.url];
  if (f) return res.writeHead(200, { "content-type": f[1] }).end(readFileSync(f[0]));
  res.writeHead(200, { "content-type": "text/html" }).end(`<!doctype html><html style="font-size:${new URL(req.url, "http://x").searchParams.get("rem") ?? 16}px"><body><div id="host"></div><script src="/probe.js"></script></body></html>`);
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const base = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM, args: ["--no-sandbox"] });
const rows = [];
for (const css of ["tw3", "tw3px", "tw4"]) for (const rem of [16, 20]) {
  const page = await browser.newPage();
  await page.goto(`${base}/?rem=${rem}`);
  await page.evaluate(([c]) => window.mountProbe(document.getElementById("host"), `/${c}.css`), [css]);
  await page.waitForTimeout(500);
  const m = await page.evaluate(() => {
    const root = document.getElementById("host").shadowRoot;
    const q = (id) => root.getElementById(id);
    const cs = (id) => (q(id) ? getComputedStyle(q(id)) : null);
    const dialog = q("dialog");
    return {
      remWidthPx: q("rem")?.getBoundingClientRect().width,
      shadow: cs("shadow")?.boxShadow,
      gradient: cs("gradient")?.backgroundImage,
      ring: cs("ring")?.boxShadow,
      dialogInShadowRoot: !!dialog,
      dialogPosition: cs("dialog")?.position,
      dialogBackground: cs("dialog")?.backgroundColor,
      dialogShadow: cs("dialog")?.boxShadow,
      dialogWidthPx: dialog?.getBoundingClientRect().width,
      overlayBackground: cs("overlay")?.backgroundColor,
      dialogInDocumentBody: !!document.querySelector("#dialog"),
    };
  });
  rows.push({ tailwind: css, hostRootPx: rem, ...m });
  await page.screenshot({ path: `out/${css}-${rem}.png` });
  await page.close();
}
await browser.close(); server.close();
const short = (s) => (s && s !== "none" ? "draws" : String(s));
console.table(rows.map((r) => ({
  tailwind: r.tailwind, hostRootPx: r.hostRootPx, "w-16 px": r.remWidthPx, "shadow-lg": short(r.shadow),
  gradient: /gradient/.test(r.gradient ?? "") ? "draws" : r.gradient, "ring-2": short(r.ring),
  "dialog in root": r.dialogInShadowRoot && !r.dialogInDocumentBody, "dialog fixed": r.dialogPosition,
  "dialog bg": r.dialogBackground, "dialog shadow": short(r.dialogShadow), "dialog w px": r.dialogWidthPx, overlay: r.overlayBackground,
})));
console.log(JSON.stringify(rows.filter((r) => r.tailwind === "tw4" && r.hostRootPx === 16).map((r) => ({ shadow: r.shadow, ring: r.ring })), null, 1));
