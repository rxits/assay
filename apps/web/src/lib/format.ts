// Small display formatters (05 §5.1). Numbers are thousands-comma'd; dates render
// humanised with the ISO string kept in a title/datetime attribute (05 §2, §5.1).

export function formatCount(n: number): string {
  return n.toLocaleString("en-US");
}

/** Humanised byte size — 4.2 MB, 248 KB (05 §5.1). */
export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let v = n / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i += 1;
  }
  return `${v < 10 ? v.toFixed(1) : Math.round(v)} ${units[i] ?? "TB"}`;
}

/** Compact magnitude — 1,284 → 1.3K → 1.2M (05 §5.1); small counts pass through. */
export function formatCompact(n: number): string {
  if (Math.abs(n) < 1000) return String(n);
  return new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(n);
}

/** Ratio 0–1 → "%" — one decimal below 10% (so 0.3% survives), else integer (05 §5.1). */
export function formatPct(ratio: number): string {
  const p = ratio * 100;
  if (p > 0 && p < 10) return `${p.toFixed(1)}%`;
  return `${Math.round(p)}%`;
}

/** Axis/tooltip date tick — "Jul 18" (05 §5.1). Dates are UTC-at-rest, so format in UTC. */
export function formatDateShort(date: string): string {
  const d = new Date(date);
  if (Number.isNaN(d.getTime())) return date;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}

/** Humanised "3d ago" / "2h ago" / "never". Pair with title={iso} for the exact time. */
export function relativeTime(iso: string | null): string {
  if (!iso) return "never";
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "—";
  const secs = Math.round((Date.now() - then) / 1000);
  if (secs < 45) return "just now";
  const mins = Math.round(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.round(hrs / 24);
  if (days < 30) return `${days}d ago`;
  const months = Math.round(days / 30);
  if (months < 12) return `${months}mo ago`;
  return `${Math.round(months / 12)}y ago`;
}
