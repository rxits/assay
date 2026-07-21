// Top-bar theme toggle. The preference store (lib/preferences) owns the state and the `.dark`
// class the design tokens key off (05 §2); this is the one-tap affordance over it, kept in the
// bar because it's the switch people reach for daily. Tapping while on "system" commits to the
// opposite of what is currently rendered — the intent behind the tap is "not this".
// The full three-way control (system / light / dark) lives in Settings → Appearance.
import { Moon, Sun } from "lucide-react";
import { setPreference, usePreferences } from "@/lib/preferences";

export function ThemeToggle() {
  const { theme } = usePreferences();
  const dark = typeof document !== "undefined" && document.documentElement.classList.contains("dark");

  return (
    <button
      type="button"
      onClick={() => setPreference("theme", dark ? "light" : "dark")}
      aria-label={dark ? "Switch to light theme" : "Switch to dark theme"}
      aria-pressed={dark}
      title={theme === "system" ? "Following your system theme" : undefined}
      className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-border bg-card text-muted-foreground outline-none transition-[color,background-color,transform] duration-150 hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring active:scale-[0.94]"
    >
      {dark ? <Sun aria-hidden="true" className="h-4 w-4" /> : <Moon aria-hidden="true" className="h-4 w-4" />}
    </button>
  );
}
