// Minimal toast — a module-level store + a single <Toaster/>. No dependency: the
// only trigger is the classification override's optimistic "Reclassified — Trust
// recomputed" (05 §4.6), so a tiny pub/sub via useSyncExternalStore is the whole
// need. Messages live in an aria-live region so AT announces them (05 §8).
import { useSyncExternalStore } from "react";
import { cn } from "@/lib/utils";

export interface Toast {
  id: number;
  message: string;
  tone: "default" | "error";
}

let toasts: Toast[] = [];
const listeners = new Set<() => void>();
let nextId = 1;

function emit() {
  for (const l of listeners) l();
}

/** Show a transient toast; auto-dismisses after `ms`. */
export function toast(message: string, tone: Toast["tone"] = "default", ms = 3200): void {
  const id = nextId++;
  toasts = [...toasts, { id, message, tone }];
  emit();
  setTimeout(() => {
    toasts = toasts.filter((t) => t.id !== id);
    emit();
  }, ms);
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

export function Toaster() {
  const items = useSyncExternalStore(subscribe, () => toasts, () => toasts);
  return (
    <div
      aria-live="polite"
      aria-atomic="false"
      className="pointer-events-none fixed bottom-4 right-4 z-[60] flex max-w-sm flex-col gap-2"
    >
      {items.map((t) => (
        <div
          key={t.id}
          role="status"
          className={cn(
            "pointer-events-auto rounded-md border px-3 py-2 text-[13px] shadow-md",
            t.tone === "error"
              ? "border-[color:var(--status-critical)] bg-popover text-foreground"
              : "border-border bg-popover text-foreground",
          )}
        >
          {t.message}
        </div>
      ))}
    </div>
  );
}
