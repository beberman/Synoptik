import React from "react";
import { createRoot } from "react-dom/client";
import * as Dialog from "@radix-ui/react-dialog";

// One page of what the interface uses: sizes in rem, a shadow, a gradient, a
// ring, a dark variant, and a dialog portalled into the shadow root.
function Probe({ container }) {
  return (
    <div id="probe" className="p-4 font-sans text-sm text-slate-900 dark:text-white">
      <div id="rem" className="h-4 w-16 bg-blue-600" />
      <div id="shadow" className="mt-4 h-10 w-10 rounded-lg bg-white shadow-lg" />
      <div id="gradient" className="mt-4 h-10 w-40 bg-gradient-to-r from-red-500 to-blue-500" />
      <button id="ring" className="mt-4 rounded px-3 py-1 ring-2 ring-blue-500">ring</button>
      <Dialog.Root defaultOpen>
        <Dialog.Portal container={container}>
          <Dialog.Overlay id="overlay" className="fixed inset-0 bg-black/50" />
          <Dialog.Content id="dialog" className="fixed left-1/2 top-1/2 w-64 -translate-x-1/2 -translate-y-1/2 rounded-2xl bg-white p-4 shadow-xl">
            <Dialog.Title className="text-lg font-semibold">Dialog</Dialog.Title>
            <Dialog.Description className="text-xs">in the shadow root</Dialog.Description>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </div>
  );
}

// Mount into a shadow root with the stylesheet adopted, as the plugin would.
window.mountProbe = async (host, cssUrl) => {
  const root = host.attachShadow({ mode: "open" });
  const css = await (await fetch(cssUrl)).text();
  const sheet = new CSSStyleSheet();
  sheet.replaceSync(css);
  root.adoptedStyleSheets = [sheet];
  const mount = document.createElement("div");
  mount.id = "mount";
  root.appendChild(mount);
  createRoot(mount).render(<Probe container={mount} />);
  return root;
};
