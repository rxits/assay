// Catch-all for unmatched routes. It renders *inside* AppShell, which is the whole point:
// a static host answers every path with index.html, so before this existed a typo'd or stale
// URL painted a blank white page — no nav, no chrome, no way back except the browser button.
import { Compass } from "lucide-react";
import { Link } from "react-router-dom";
import { cn } from "@/lib/utils";

const GLASS_CARD = "glass rounded-xl border border-[color:var(--glass-border)]";

export function NotFoundPage() {
  return (
    <div className={cn(GLASS_CARD, "flex flex-col items-center gap-3 px-6 py-20 text-center")}>
      <span className="grid h-12 w-12 place-items-center rounded-2xl bg-primary/12 text-primary ring-1 ring-inset ring-primary/20">
        <Compass aria-hidden="true" className="h-5 w-5" />
      </span>
      <h1 className="text-balance text-[16px] font-semibold text-foreground">Page not found</h1>
      <p className="max-w-sm text-pretty text-[13px] text-muted-foreground">
        That address doesn’t match anything in the catalog. A dataset link can also go stale if
        the dataset was removed.
      </p>
      <Link
        to="/"
        className="mt-1 inline-flex items-center gap-1.5 rounded-lg border border-[color:var(--glass-border)] px-3 py-2 text-[13px] font-medium outline-none transition-colors hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring"
      >
        Back to the overview
      </Link>
    </div>
  );
}
