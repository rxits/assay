// Dataset detail — Phase 3B placeholder. Renders the header, status, and the
// three score gauges (the detail/button variant, ready for the "explain this
// score" popover). The columns table, charts, override control and breakdown
// popover land in Phase 3C (05 §6b).
import { ChevronLeft } from "lucide-react";
import { Link, useParams } from "react-router-dom";
import { RecommendationBadge } from "@/components/dataset/SensitivityBadge";
import { ScoreGauge } from "@/components/dataset/ScoreGauge";
import { ThemeToggle } from "@/components/ThemeToggle";
import { useDataset } from "@/lib/api";
import { formatCount } from "@/lib/format";

export function DatasetDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { data, isLoading, isError, error } = useDataset(id);

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="sticky top-0 z-10 border-b border-border bg-background/90 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-4 md:px-6">
          <Link
            to="/"
            className="inline-flex items-center gap-1 text-[14px] text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
          >
            <ChevronLeft aria-hidden="true" className="h-4 w-4" />
            Catalog
          </Link>
          <ThemeToggle />
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-4 py-6 md:px-6">
        {isLoading && <p className="text-muted-foreground">Loading…</p>}
        {isError && (
          <p className="text-[color:var(--status-critical)]">
            {error instanceof Error ? error.message : "Couldn't load this dataset."}
          </p>
        )}

        {data && (
          <>
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h1 className="text-[24px] font-semibold tracking-tight">{data.name}</h1>
              <span className="text-[13px] text-muted-foreground">
                {data.fileType} · {formatCount(data.rowCount)} rows · {formatCount(data.columnCount)} cols ·{" "}
                {data.status}
              </span>
            </div>

            {data.status === "READY" ? (
              <section
                aria-label="Scores"
                className="mt-6 flex flex-wrap items-start gap-6 rounded-lg border border-border bg-card p-6 shadow-xs"
              >
                <ScoreGauge score={data.qualityScore} label="Quality" variant="detail" status={data.status} />
                <ScoreGauge score={data.trustScore} label="Trust" variant="detail" status={data.status} />
                <ScoreGauge score={data.valueScore} label="Value" variant="detail" status={data.status} />
                <div className="ml-auto flex flex-col gap-2">
                  <span className="text-[11px] font-semibold uppercase tracking-[0.04em] text-muted-foreground">
                    Recommendation
                  </span>
                  <RecommendationBadge value={data.valueRecommendation} />
                </div>
              </section>
            ) : (
              <p className="mt-6 rounded-lg border border-border bg-card p-6 text-[14px] text-muted-foreground">
                {data.status === "FAILED"
                  ? (data.errorMessage ?? "This dataset failed to process.")
                  : "Profiling…"}
              </p>
            )}

            <p className="mt-6 text-[13px] text-muted-foreground">
              Columns, the usage chart, the manual-override control and the “explain this score”
              breakdown arrive in Phase 3C.
            </p>
          </>
        )}
      </main>
    </div>
  );
}
