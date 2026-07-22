// Upload dropzone — 05 §7. The primary ingestion affordance (POST /datasets).
// Drag-drop or click-to-browse, .csv/.xlsx only; wrong type → inline critical
// message, no upload. On drop: filename chip + determinate upload bar →
// indeterminate "Profiling…" while the inline pipeline runs → success adds the
// row (list refetch). Failure surfaces a graceful message, never a stack trace.
import { useRef, useState, type DragEvent } from "react";
import { FileUp, TriangleAlert, X } from "lucide-react";
import { Link } from "react-router-dom";
import { useSystem, useUploadDataset } from "@/lib/api";
import { cn } from "@/lib/utils";

type Phase =
  | { kind: "idle" }
  | { kind: "uploading"; name: string; pct: number }
  | { kind: "profiling"; name: string }
  | { kind: "done"; name: string; id: string; failed: boolean; error: string | null }
  | { kind: "error"; message: string };

const ACCEPT = [".csv", ".xlsx"];

function hasAcceptedExtension(name: string): boolean {
  const lower = name.toLowerCase();
  return ACCEPT.some((ext) => lower.endsWith(ext));
}

export function UploadDropzone({ onUploaded }: { onUploaded?: () => void }) {
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const upload = useUploadDataset();
  const system = useSystem();
  const maxUploadMb = system.data?.ingestion.maxUploadMb ?? 25;

  function start(file: File) {
    if (!hasAcceptedExtension(file.name)) {
      setPhase({ kind: "error", message: `Only CSV or XLSX files are accepted (got "${file.name}").` });
      return;
    }
    setPhase({ kind: "uploading", name: file.name, pct: 0 });
    upload.mutate(
      {
        file,
        onProgress: (fraction) => {
          setPhase((p) =>
            p.kind === "uploading" && fraction < 1
              ? { kind: "uploading", name: file.name, pct: fraction }
              : { kind: "profiling", name: file.name },
          );
        },
      },
      {
        onSuccess: (ds) => {
          // 201 means "catalogued", not "profiled" — a FAILED dataset is a first-class row,
          // so reporting success on it would be telling the user the opposite of the truth.
          setPhase({
            kind: "done",
            name: ds.name,
            id: ds.id,
            failed: ds.status === "FAILED",
            error: ds.errorMessage ?? null,
          });
          onUploaded?.();
        },
        onError: (err) => {
          setPhase({ kind: "error", message: err instanceof Error ? err.message : "Upload failed." });
        },
      },
    );
  }

  function onDrop(e: DragEvent) {
    e.preventDefault();
    setDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file) start(file);
  }

  const busy = phase.kind === "uploading" || phase.kind === "profiling";

  return (
    <div>
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        aria-label="Upload a CSV or XLSX dataset — drop a file here or activate to browse"
        className={cn(
          "flex w-full flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed px-6 py-8 text-center outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring",
          dragging ? "border-primary bg-accent" : "border-border hover:bg-accent/50",
        )}
      >
        <FileUp aria-hidden="true" className="h-6 w-6 text-muted-foreground" />
        <span className="text-[14px] font-medium text-foreground">
          Drop a CSV or XLSX file, or click to browse
        </span>
        <span className="text-[12px] text-muted-foreground">
          Up to {maxUploadMb} MB · first sheet of an XLSX
        </span>
      </button>

      <input
        ref={inputRef}
        type="file"
        accept=".csv,.xlsx"
        className="sr-only"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) start(file);
          e.target.value = "";
        }}
      />

      {/* Live status region (05 §8 — aria-live announces "Profiling complete"). */}
      <div aria-live="polite" className="mt-3 empty:hidden">
        {busy && (
          <div className="rounded-md border border-border bg-card p-3">
            <div className="flex items-center justify-between text-[13px]">
              <span className="truncate font-medium text-foreground">{phase.name}</span>
              <span className="text-muted-foreground">
                {phase.kind === "uploading" ? `Uploading ${Math.round(phase.pct * 100)}%` : "Profiling…"}
              </span>
            </div>
            <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-muted">
              {phase.kind === "uploading" ? (
                <div
                  className="h-full rounded-full bg-primary transition-[width] duration-150"
                  style={{ width: `${Math.round(phase.pct * 100)}%` }}
                />
              ) : (
                <div className="assay-indeterminate h-full w-full rounded-full" />
              )}
            </div>
          </div>
        )}

        {phase.kind === "done" && (
          <div className="flex items-start gap-2 rounded-md border border-border bg-card p-3 text-[13px]">
            {phase.failed && (
              <TriangleAlert
                aria-hidden="true"
                className="mt-0.5 h-4 w-4 shrink-0 text-[color:var(--status-critical-fg,var(--status-critical))]"
              />
            )}
            <p className="text-foreground">
              {phase.failed ? (
                <>
                  <span className="font-medium">{phase.name}</span> was catalogued but could not be
                  profiled{phase.error ? `: ${phase.error}` : "."}
                </>
              ) : (
                <>
                  Added <span className="font-medium">{phase.name}</span> to the catalog.
                </>
              )}{" "}
              <Link to={`/datasets/${phase.id}`} className="font-medium text-primary underline-offset-2 hover:underline">
                View dataset
              </Link>
            </p>
          </div>
        )}

        {phase.kind === "error" && (
          <div className="flex items-start justify-between gap-2 rounded-md border border-border bg-card p-3">
            <p className="text-[13px] text-[color:var(--status-critical-fg)]">{phase.message}</p>
            <button
              type="button"
              onClick={() => setPhase({ kind: "idle" })}
              aria-label="Dismiss"
              className="shrink-0 rounded p-0.5 text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
            >
              <X aria-hidden="true" className="h-4 w-4" />
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
