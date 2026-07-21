// Client-side preferences (R3) — theme, table density, motion, cursor spotlight.
// Device-scoped, so they live in localStorage rather than the settings API: a laptop and a
// projector want different answers, and none of them belong in the catalog's data model.
//
// Same store shape as lib/toast.tsx (a module-level value + a listener set read through
// useSyncExternalStore) — no context provider, no re-render of the tree above the reader,
// and `applyPreferences` can run before React mounts so there is no theme flash.
import { useSyncExternalStore } from "react";

export type ThemePreference = "dark" | "light" | "system";
export type DensityPreference = "comfortable" | "compact";
export type MotionPreference = "system" | "reduced";

export interface Preferences {
  theme: ThemePreference;
  density: DensityPreference;
  motion: MotionPreference;
  spotlight: boolean;
}

export const defaultPreferences: Preferences = {
  theme: "system",
  density: "comfortable",
  motion: "system",
  spotlight: true,
};

const STORAGE_KEY = "assay-preferences";
const LEGACY_THEME_KEY = "assay-theme"; // pre-R3 ThemeToggle wrote this

function isTheme(v: unknown): v is ThemePreference {
  return v === "dark" || v === "light" || v === "system";
}

function read(): Preferences {
  if (typeof localStorage === "undefined") return { ...defaultPreferences };
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const stored = raw ? (JSON.parse(raw) as Partial<Preferences>) : {};
    const legacy = localStorage.getItem(LEGACY_THEME_KEY);
    return {
      theme: isTheme(stored.theme) ? stored.theme : isTheme(legacy) ? legacy : defaultPreferences.theme,
      density: stored.density === "compact" ? "compact" : defaultPreferences.density,
      motion: stored.motion === "reduced" ? "reduced" : defaultPreferences.motion,
      spotlight: typeof stored.spotlight === "boolean" ? stored.spotlight : defaultPreferences.spotlight,
    };
  } catch {
    // Private mode / corrupt JSON — preferences are a nicety, never a blocker.
    return { ...defaultPreferences };
  }
}

let preferences: Preferences = read();
const listeners = new Set<() => void>();

const prefersDark = (): boolean =>
  typeof window !== "undefined" &&
  typeof window.matchMedia === "function" &&
  window.matchMedia("(prefers-color-scheme: dark)").matches;

/**
 * Push preferences onto <html>. Theme flips the `.dark` class the tokens key off (05 §2);
 * density and motion become data-attributes CSS keys off (see index.css), which keeps both
 * out of React's render path entirely.
 */
export function applyPreferences(p: Preferences = preferences): void {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  root.classList.toggle("dark", p.theme === "dark" || (p.theme === "system" && prefersDark()));
  root.dataset.density = p.density;
  root.dataset.motion = p.motion;
}

export function getPreferences(): Preferences {
  return preferences;
}

export function setPreference<K extends keyof Preferences>(key: K, value: Preferences[K]): void {
  if (preferences[key] === value) return;
  preferences = { ...preferences, [key]: value };
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(preferences));
    if (key === "theme") localStorage.removeItem(LEGACY_THEME_KEY); // the new key is authoritative
  } catch {
    /* persistence is best-effort */
  }
  applyPreferences();
  for (const l of listeners) l();
}

export function resetPreferences(): void {
  preferences = { ...defaultPreferences };
  try {
    localStorage.removeItem(STORAGE_KEY);
    localStorage.removeItem(LEGACY_THEME_KEY);
  } catch {
    /* best effort */
  }
  applyPreferences();
  for (const l of listeners) l();
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

const snapshot = () => preferences;

export function usePreferences(): Preferences {
  return useSyncExternalStore(subscribe, snapshot, snapshot);
}

// Theme "system" must keep tracking the OS after load, not just at boot.
if (typeof window !== "undefined" && typeof window.matchMedia === "function") {
  const mq = window.matchMedia("(prefers-color-scheme: dark)");
  const onChange = () => {
    if (preferences.theme === "system") {
      applyPreferences();
      for (const l of listeners) l();
    }
  };
  // Safari < 14 only has the deprecated listener API.
  if (typeof mq.addEventListener === "function") mq.addEventListener("change", onChange);
  else mq.addListener?.(onChange);
}
