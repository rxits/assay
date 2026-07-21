// Small display formatters (05 §5.1). Numbers are thousands-comma'd; dates render
// humanised with the ISO string kept in a title/datetime attribute (05 §2, §5.1).

export function formatCount(n: number): string {
  return n.toLocaleString("en-US");
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
