// Light/dark toggle — flips the `.dark` class the design tokens key off (05 §2).
// Initial theme is set in main.tsx before paint; this only toggles + persists.
import { useState } from "react";
import { Moon, Sun } from "lucide-react";

const STORAGE_KEY = "assay-theme";

export function ThemeToggle() {
  const [dark, setDark] = useState(
    () => typeof document !== "undefined" && document.documentElement.classList.contains("dark"),
  );

  function toggle() {
    const next = !dark;
    setDark(next);
    document.documentElement.classList.toggle("dark", next);
    try {
      localStorage.setItem(STORAGE_KEY, next ? "dark" : "light");
    } catch {
      /* private mode — persistence is best-effort */
    }
  }

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={dark ? "Switch to light theme" : "Switch to dark theme"}
      aria-pressed={dark}
      className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-border bg-card text-muted-foreground outline-none transition-colors hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
    >
      {dark ? <Sun aria-hidden="true" className="h-4 w-4" /> : <Moon aria-hidden="true" className="h-4 w-4" />}
    </button>
  );
}
