import { useSyncExternalStore } from "react";

/** Collapsed / expanded sidebar, remembered per browser and shared by the sidebar and the layout. */

const KEY = "sidebar:collapsed";
const EVENT = "sidebar-toggle";
// Used when browser storage is unavailable (private mode, blocked site data).
let memory = false;

function read(): boolean {
  try { const v = window.localStorage.getItem(KEY); if (v !== null) return v === "1"; } catch { /* fall back */ }
  return memory;
}
function subscribe(cb: () => void) {
  window.addEventListener(EVENT, cb);
  window.addEventListener("storage", cb);
  return () => { window.removeEventListener(EVENT, cb); window.removeEventListener("storage", cb); };
}

export function setSidebarCollapsed(v: boolean) {
  memory = v;
  try { window.localStorage.setItem(KEY, v ? "1" : "0"); } catch { /* not remembered across visits */ }
  window.dispatchEvent(new Event(EVENT));
}

export function useSidebarCollapsed(): boolean {
  return useSyncExternalStore(subscribe, read, () => false);
}

export const SIDEBAR_WIDTH = { open: 264, closed: 84 } as const;
