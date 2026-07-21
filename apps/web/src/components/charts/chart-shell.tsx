// Shared chart states — 05 §5.4. Skeleton (first paint) and empty (no data) so a
// figure is never a blank box or a spinner-in-a-void. Loading holds the frame at
// the final layout height; empty is a centred muted line + optional icon.
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

export function ChartSkeleton({ height = 180, className }: { height?: number; className?: string }) {
  return (
    <div
      style={{ height }}
      className={cn("w-full animate-pulse rounded-md bg-muted/60", className)}
      aria-hidden="true"
    />
  );
}

export function ChartEmpty({
  icon: Icon,
  message,
  height = 180,
}: {
  icon?: LucideIcon;
  message: string;
  height?: number;
}) {
  return (
    <div
      style={{ minHeight: height }}
      className="flex flex-col items-center justify-center gap-2 px-4 text-center text-[13px] text-muted-foreground"
    >
      {Icon && <Icon aria-hidden="true" className="h-6 w-6 opacity-60" />}
      <p>{message}</p>
    </div>
  );
}
