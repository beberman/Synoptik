// PLAN-0062 S1 and S3: the probe plugin, installed by CloudCLI's own install path,
// opened in CloudCLI at desktop and phone width.
import { chromium } from "playwright-core";
const base = process.env.CLOUDCLI ?? "http://127.0.0.1:3055";
const token = process.env.CC_TOKEN;
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM, args: ["--no-sandbox"] });
const out = [];
for (const [label, viewport] of [["desktop", { width: 1280, height: 800 }], ["phone", { width: 360, height: 740 }]]) {
  const page = await browser.newPage({ viewport });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.addInitScript((t) => localStorage.setItem("auth-token", t), token);
  await page.goto(base);
  await page.waitForTimeout(3000);
  if (label === "phone") await page.getByRole("button", { name: /open menu/i }).first().click().catch(() => {});
  await page.waitForTimeout(500);
  await page.getByText("proj", { exact: true }).first().click().catch(() => {});
  await page.waitForTimeout(2500);
  const hostRoot = await page.evaluate(() => getComputedStyle(document.documentElement).fontSize);
  const tabsBefore = await page.evaluate(() => [...document.querySelectorAll("button, [role=tab], a")].map((e) => (e.getAttribute("aria-label") || e.textContent || "").trim()).filter(Boolean).slice(0, 40));
  await page.screenshot({ path: `out/cloudcli-${label}-home.png` });
  // find and open the plugin's tab
  const tab = page.getByText("S1 Probe").first();
  const visible = await tab.isVisible().catch(() => false);
  let measure = null;
  if (visible) {
    await tab.click();
    await page.waitForTimeout(1500);
    measure = await page.evaluate(() => {
      const find = (root) => { for (const e of root.querySelectorAll("*")) { if (e.shadowRoot && e.shadowRoot.getElementById("probe")) return e.shadowRoot; } return null; };
      const root = find(document);
      if (!root) return null;
      const cs = (id) => getComputedStyle(root.getElementById(id));
      const dialog = root.getElementById("dialog");
      return {
        w16Px: root.getElementById("rem").getBoundingClientRect().width,
        shadow: cs("shadow").boxShadow !== "none", gradient: /gradient/.test(cs("gradient").backgroundImage),
        ring: cs("ring").boxShadow !== "none", dialogInRoot: !!dialog, dialogShadow: dialog && getComputedStyle(dialog).boxShadow !== "none",
        dialogWidth: dialog?.getBoundingClientRect().width, ringHeight: root.getElementById("ring").getBoundingClientRect().height,
      };
    });
    await page.screenshot({ path: `out/cloudcli-${label}-plugin.png` });
  }
  const tabsAfter = await page.evaluate(() => [...document.querySelectorAll("button, [role=tab], a")].map((e) => (e.getAttribute("aria-label") || e.textContent || "").trim()).filter(Boolean).slice(0, 40));
  out.push({ label, hostRoot, pluginTabVisible: visible, measure, errors, tabsBefore, tabsAfter });
  await page.close();
}
await browser.close();
for (const o of out) console.log(JSON.stringify(o, null, 1));
