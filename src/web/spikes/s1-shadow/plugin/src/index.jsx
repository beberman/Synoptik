import React from "react";
import { createRoot } from "react-dom/client";
import * as Dialog from "@radix-ui/react-dialog";
import css from "tw-css";

function Probe({ container, theme }) {
  return (
    <div data-theme={theme} id="probe" className="p-4 font-sans text-sm text-slate-900 data-[theme=dark]:bg-slate-900 data-[theme=dark]:text-white">
      <div id="rem" className="h-4 w-16 bg-blue-600" />
      <div id="shadow" className="mt-4 h-10 w-10 rounded-lg bg-white shadow-lg" />
      <div id="gradient" className="mt-4 h-10 w-40 bg-gradient-to-r from-red-500 to-blue-500" />
      <button id="ring" className="mt-4 min-h-[44px] rounded px-3 py-1 ring-2 ring-blue-500">ring</button>
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

const roots = new WeakMap();

export function mount(container, api) {
  const shadow = container.attachShadow({ mode: "open" });
  const sheet = new CSSStyleSheet();
  sheet.replaceSync(css);
  shadow.adoptedStyleSheets = [sheet];
  const mountPoint = document.createElement("div");
  shadow.appendChild(mountPoint);
  const root = createRoot(mountPoint);
  const render = (ctx) => root.render(<Probe container={mountPoint} theme={ctx?.theme} />);
  render(api.context);
  const off = api.onContextChange?.(render);
  roots.set(container, { root, off });
}

export function unmount(container) {
  const entry = roots.get(container);
  entry?.off?.();
  entry?.root.unmount();
  roots.delete(container);
}
