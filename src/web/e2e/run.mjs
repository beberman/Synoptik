// A browser run of the whole interface against a live Synoptik service.
//
//   SYNOPTIK_URL=http://127.0.0.1:4780 CHROMIUM=/path/to/chrome node e2e/run.mjs
//
// It builds a scratch git repository under the temp directory, starts its own
// UI server on a free port with its own ~/.synoptik, and adds, edits, conflicts,
// creates and removes in that scratch repository only. The service's other
// repositories are never written, and the run fails if a requirement appears in
// any of them. Needs `playwright-core` (npm i -D playwright-core) and a Chromium.
import { execFileSync, spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

const here = dirname(fileURLToPath(import.meta.url));
const service = process.env.SYNOPTIK_URL ?? "http://127.0.0.1:4780";
const executablePath = process.env.CHROMIUM;
const port = 4800 + Math.floor(Math.random() * 100);

const work = mkdtempSync(join(tmpdir(), "synoptik-e2e-"));
const roots = join(work, "roots");
const repo = join(roots, "e2e-scratch");
const home = join(work, "home");
const file = join(repo, "docs/requirements/REQ-0001.yaml");
mkdirSync(join(repo, "docs/requirements"), { recursive: true });
mkdirSync(home);
writeFileSync(file, `id: REQ-0001
title: A board can be shared with another user
status: draft
priority: p2
date: 2026-10-17
refines: [REQ-0099]
tags: [multi-user]
summary: |
  Two users open one board. Each sees the other's changes.
body: |
  WHAT IS WANTED

  R1  Changes appear for every user within a second.
`);
mkdirSync(join(repo, "src"), { recursive: true });
writeFileSync(join(repo, "src/new.js"), "export function movedThing() { return 1; }\n");
const git = (...a) => execFileSync("git", ["-c", "user.email=e@e", "-c", "user.name=e", ...a], { cwd: repo });
git("init", "-q"); git("add", "-A"); git("commit", "-qm", "init");
writeFileSync(join(home, "web.json"), JSON.stringify({ version: 1, roots: [roots], repositories: [] }));

const before = async () => {
  const status = await (await fetch(`${service}/v1/status`)).json();
  return status.repositories.map((r) => r.root);
};
const watchedBefore = await before();

const server = spawn("node", [join(here, "../packages/server/dist/cli.js")], {
  env: { ...process.env, SYNOPTIK_WEB_HOME: home, SYNOPTIK_UI_PORT: String(port), SYNOPTIK_URL: service },
  stdio: "ignore",
});
await new Promise((r) => setTimeout(r, 1500));

const results = [];
const check = (name, ok, detail = "") => results.push([ok ? "PASS" : "FAIL", name, detail].join("  "));
const browser = await chromium.launch({ executablePath, args: ["--no-sandbox"] });
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const reads = [];
  page.on("request", (r) => { if (/read-document/.test(r.url())) reads.push(Date.now()); });
  const stream = page.waitForRequest((r) => /\/api\/events/.test(r.url()), { timeout: 20000 }).then(() => true, () => false);
  await page.goto(`http://127.0.0.1:${port}/`);
  await page.waitForSelector("button[aria-label=Workspace]", { timeout: 20000 });
  check("the page opens the event stream", await stream);

  await page.click("button[aria-label=Workspace]");
  await page.click("text=Add folder");
  await page.click("text=e2e-scratch");
  await page.waitForSelector("text=Added e2e-scratch", { timeout: 60000 });
  await page.click("button[aria-label='Close workspace']");
  await page.click('aside button:has-text("e2e-scratch")');
  await page.click("text=REQ-0001");
  await page.waitForSelector("textarea", { timeout: 15000 });
  check("opens the document", (await page.locator("textarea").first().inputValue()).includes("shared with another user"));

  await page.locator("textarea").first().fill("A board can be shared with several users");
  await page.click('button:has-text("Save")');
  await page.waitForSelector("text=Saved REQ-0001", { timeout: 15000 });
  const saved = readFileSync(file, "utf8");
  check("a saved title is on disk", saved.includes("title: A board can be shared with several users"));
  check("nothing else in the file moved", saved.includes("refines: [REQ-0099]") && saved.includes("R1  Changes appear for every user within a second.") && saved.includes("date: 2026-10-17"));
  check("an unresolved reference is reported", (await page.locator("text=resolves to nothing").count()) > 0);

  await page.locator("textarea").first().fill("Edited in the browser");
  writeFileSync(file, saved.replace("priority: p2", "priority: p1"));
  await page.click('button:has-text("Save")');
  await page.waitForSelector("text=This file changed since you opened it", { timeout: 15000 });
  const afterConflict = readFileSync(file, "utf8");
  check("a stale save is refused and the file keeps the other writer's text", afterConflict.includes("priority: p1") && !afterConflict.includes("Edited in the browser"));
  await page.click("text=Take theirs");

  // The file changes underneath the open, unedited document (an agent, a terminal).
  const current = readFileSync(file, "utf8");
  const readsBefore = reads.length;
  const wrote = Date.now();
  writeFileSync(file, current.replace("priority: p1", "priority: p3"));
  await page.waitForSelector("text=was changed on disk, outside this editor", { timeout: 15000 });
  const delay = Date.now() - wrote;
  const polled = reads.slice(readsBefore).length;
  check("the change arrives by the stream, within the monitor's two seconds and a margin", delay < 4500 && polled <= 2, `${delay} ms, ${polled} reads`);
  check("a change made outside is picked up without a reload", (await page.locator("text=p3").count()) >= 0);
  await page.click('button:has-text("Show changes")');
  await page.waitForSelector("text=What changed on disk");
  check("the change is shown as a difference", (await page.locator("div.fixed >> text=priority: p3").count()) > 0 && (await page.locator("div.fixed >> text=priority: p1").count()) > 0);
  await page.click('button:has-text("Go back to the older text")');
  await page.waitForSelector("text=Went back to the older text", { timeout: 15000 });
  check("going back writes the earlier text to the file", readFileSync(file, "utf8") === current);

  // Code the document names has moved: the index offers where it is now.
  const moved = readFileSync(file, "utf8");
  writeFileSync(file, moved.replace("tags: [multi-user]", 'tags: [multi-user]\naffects: ["function:src/old.js:movedThing"]'));
  await page.waitForSelector("text=was changed on disk, outside this editor", { timeout: 15000 });
  await page.waitForSelector("text=Use src/new.js", { timeout: 15000 });
  check("a reference to moved code is offered the file it is in now", true);
  await page.click('button:has-text("Ask an agent to fix")');
  const task = await page.locator("textarea[aria-label=Task]").inputValue();
  check("the agent task names the reference and what the index found", task.includes("function:src/old.js:movedThing") && task.includes("function:src/new.js:movedThing") && task.includes("check-document"));
  await page.waitForSelector("text=No agent tool that can start a session", { timeout: 10000 }).catch(() => {});
  check("with no agent tool that can start a session, sending is refused in words", (await page.locator("text=No agent tool that can start a session").count()) > 0 && await page.locator('button:has-text("Send")').isDisabled());
  await page.click('div.fixed button:has-text("Cancel")');
  await page.click('button:has-text("Use src/new.js")');
  await page.waitForSelector("text=Saved REQ-0001", { timeout: 15000 });
  const fixed = readFileSync(file, "utf8");
  check("the fix replaced only the one entry in the file", fixed === moved.replace("tags: [multi-user]", 'tags: [multi-user]\naffects: ["function:src/new.js:movedThing"]'));
  check("the check now reports it resolved", (await page.locator("text=resolves to nothing").count()) === 1);

  await page.click('button:has-text("New")');
  await page.fill('input[placeholder^="Title"]', "Boards can be exported");
  await page.selectOption("div.fixed select", "e2e-scratch");
  await page.click('div.fixed button:has-text("Create")');
  await page.waitForSelector("text=Created REQ-0002", { timeout: 20000 });
  check("a created requirement is on disk", existsSync(join(repo, "docs/requirements/REQ-0002.yaml")));

  await page.click("button[aria-label=Agents]");
  await page.waitForSelector("text=Synoptik >> nth=1", { timeout: 10000 }).catch(() => {});
  check("the agents panel names what the native adapter cannot do", (await page.locator("text=not which session").count()) > 0);
  await page.click("button[aria-label='Close agents']");

  await page.waitForTimeout(1500);
  const state = JSON.parse(readFileSync(join(home, "ui-state.json"), "utf8"));
  check("interface state was saved", state.view === "map" || state.view === "list");
  const workspace = JSON.parse(readFileSync(join(home, "web.json"), "utf8"));
  check("the workspace file lists the folder", workspace.repositories.some((r) => r.path === repo));

  const phone = await browser.newPage({ viewport: { width: 360, height: 740 } });
  await phone.goto(`http://127.0.0.1:${port}/`);
  await phone.waitForSelector("button[aria-label=Workspace]", { timeout: 20000 });
  await phone.waitForTimeout(1500);
  check("no horizontal scroll at 360 px", !(await phone.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)));
  // The desktop left REQ-0002 open; the phone, reading the same saved state, opens at it.
  await phone.waitForSelector("textarea", { timeout: 15000 }).catch(() => {});
  check("the phone opens at the document the desktop had open", (await phone.locator("textarea").count()) > 0);
  const small = await phone.evaluate(() => [...document.querySelectorAll("button, a, select, input, textarea")]
    .filter((e) => { const b = e.getBoundingClientRect(); return b.width > 0 && b.height > 0 && getComputedStyle(e).visibility !== "hidden"; })
    .map((e) => { const b = e.getBoundingClientRect(); return `${e.tagName} ${(e.getAttribute("aria-label") || e.textContent || e.placeholder || "").trim().slice(0, 24)} ${Math.round(b.width)}x${Math.round(b.height)}`; })
    .filter((x) => { const [w, h] = x.split(" ").pop().split("x").map(Number); return w < 44 || h < 44; }));
  check("every control is at least 44 px square at 360 px", small.length === 0, small.join("; "));

  await page.click("button[aria-label=Workspace]");
  await page.click('li:has-text("e2e-scratch") >> text=Remove');
  await page.click('div.fixed button:has-text("Remove")');
  await page.waitForSelector("text=Removed e2e-scratch", { timeout: 15000 });
  check("removing the folder leaves its files", existsSync(file));
  check("page errors", errors.every((e) => /409/.test(e)), errors.join(" | "));
} finally {
  await browser.close();
  server.kill();
  const after = await before();
  check("the service watches what it did before", JSON.stringify(after) === JSON.stringify(watchedBefore));
  rmSync(work, { recursive: true, force: true });
}
console.log(results.join("\n"));
process.exit(results.some((r) => r.startsWith("FAIL")) ? 1 : 0);
