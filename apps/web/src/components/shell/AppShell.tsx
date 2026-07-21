// AppShell (R1.1) — the premium dark-glass frame every page renders inside.
// Grounded in the design skills: a glass translucent top bar + collapsible glass
// rail (ui-styling / design-system), a Linear-style cursor spotlight and springy
// active-nav indicator (motion-foundations / motion-ui), and the small-details
// polish (hit areas ≥ 40px, tabular chrome, split enter/exit) from
// make-interfaces-feel-better. All motion is gated by useReducedMotion() and the
// spotlight additionally by (hover:hover)+(pointer:fine) so touch never pays for it.
import { useEffect, useRef, useState, type ComponentType } from "react";
import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import {
  FlaskConical,
  LayoutDashboard,
  PanelLeft,
  PanelLeftClose,
  Search,
  Table2,
  Upload,
  X,
  type LucideProps,
} from "lucide-react";
import { ThemeToggle } from "@/components/ThemeToggle";
import { UploadDropzone } from "@/components/catalog/UploadDropzone";
import { motionTokens, springs } from "@/lib/motion";
import { cn } from "@/lib/utils";

const SIDEBAR_KEY = "assay-sidebar";
const HAIRLINE = "border-[color:var(--glass-border)]";

const NAV = [
  { to: "/", label: "Overview", icon: LayoutDashboard, end: true },
  { to: "/catalog", label: "Catalog", icon: Table2, end: false },
] as const;

// ---- Cursor spotlight ----------------------------------------------------
// A single fixed radial glow tracking the pointer, tinted with the brand blue at
// very low opacity (never a decorative colour blob). GPU-cheap: one rAF-throttled
// CSS-var write per frame, pointer-events:none, behind all content (z-0).
function CursorSpotlight() {
  const reduce = useReducedMotion() ?? false;
  const ref = useRef<HTMLDivElement>(null);
  const [enabled, setEnabled] = useState(false);

  useEffect(() => {
    if (reduce) return;
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return;
    if (!window.matchMedia("(hover: hover) and (pointer: fine)").matches) return;
    setEnabled(true);

    let raf = 0;
    const onMove = (e: PointerEvent) => {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        const el = ref.current;
        if (!el) return;
        el.style.setProperty("--spot-x", `${e.clientX}px`);
        el.style.setProperty("--spot-y", `${e.clientY}px`);
      });
    };
    window.addEventListener("pointermove", onMove, { passive: true });
    return () => {
      window.removeEventListener("pointermove", onMove);
      if (raf) cancelAnimationFrame(raf);
    };
  }, [reduce]);

  if (!enabled) return null;
  return (
    <div
      ref={ref}
      aria-hidden="true"
      className="pointer-events-none fixed inset-0 z-0"
      style={{
        background:
          "radial-gradient(560px circle at var(--spot-x, 50%) var(--spot-y, -10%), var(--spotlight), transparent 62%)",
      }}
    />
  );
}

// ---- Brand + command affordance -----------------------------------------
function BrandMark() {
  return (
    <NavLink
      to="/"
      className="flex items-center gap-2 rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring"
      aria-label="assay — home"
    >
      <span className="grid h-8 w-8 place-items-center rounded-lg bg-primary/12 text-primary ring-1 ring-inset ring-primary/20">
        <FlaskConical aria-hidden="true" className="h-[18px] w-[18px]" strokeWidth={2.1} />
      </span>
      <span className="text-[15px] font-semibold tracking-tight text-foreground">assay</span>
    </NavLink>
  );
}

// Command/search affordance. ⌘K (or click) routes to the catalog — the place to
// browse and filter datasets. A real palette is out of R1 scope; this is the entry
// point, kept honest and keyboard-reachable rather than a dead decorative field.
function CommandButton() {
  const navigate = useNavigate();
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        navigate("/catalog");
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [navigate]);

  return (
    <button
      type="button"
      onClick={() => navigate("/catalog")}
      className={cn(
        "group flex h-9 w-full items-center gap-2 rounded-lg border bg-background/40 px-3 text-left outline-none transition-colors",
        HAIRLINE,
        "hover:bg-accent/60 focus-visible:ring-2 focus-visible:ring-ring",
      )}
    >
      <Search aria-hidden="true" className="h-4 w-4 text-muted-foreground" />
      <span className="flex-1 truncate text-[13px] text-muted-foreground">Search datasets…</span>
      <kbd className="hidden items-center gap-0.5 rounded border border-border px-1.5 font-sans text-[11px] text-muted-foreground sm:inline-flex">
        ⌘K
      </kbd>
    </button>
  );
}

// ---- Top bar -------------------------------------------------------------
function TopBar({ onUpload }: { onUpload: () => void }) {
  return (
    <header className={cn("glass sticky top-0 z-40 border-b", HAIRLINE)}>
      <div className="flex h-14 items-center gap-3 px-3 md:px-4">
        <BrandMark />
        <div className="flex flex-1 justify-center px-2">
          <div className="hidden w-full max-w-sm sm:block">
            <CommandButton />
          </div>
        </div>
        <div className="flex items-center gap-2">
          <ThemeToggle />
          <button
            type="button"
            onClick={onUpload}
            className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-primary px-3 text-[13px] font-medium text-primary-foreground outline-none transition-[transform,opacity] hover:opacity-90 focus-visible:ring-2 focus-visible:ring-ring active:scale-[0.97]"
          >
            <Upload aria-hidden="true" className="h-4 w-4" />
            <span className="hidden sm:inline">Upload</span>
          </button>
        </div>
      </div>
    </header>
  );
}

// ---- Sidebar rail --------------------------------------------------------
type RailRowProps = {
  icon: ComponentType<LucideProps>;
  label: string;
  active?: boolean;
  expanded: boolean;
  reduce: boolean;
};

/** Shared visual for a rail entry; the springy active wash rides a shared layoutId. */
function RailRowInner({ icon: Icon, label, active, expanded, reduce }: RailRowProps) {
  return (
    <>
      {active && (
        <motion.span
          layoutId="nav-active"
          aria-hidden="true"
          transition={reduce ? { duration: 0 } : springs.snappy}
          className={cn("absolute inset-0 rounded-lg bg-accent ring-1 ring-inset", HAIRLINE)}
        />
      )}
      <Icon
        aria-hidden="true"
        className={cn(
          "relative z-10 h-[18px] w-[18px] shrink-0 transition-colors",
          active ? "text-primary" : "text-muted-foreground group-hover:text-foreground",
        )}
        strokeWidth={2.1}
      />
      <span
        className={cn(
          "relative z-10 whitespace-nowrap text-[14px] font-medium transition-colors",
          active ? "text-foreground" : "text-muted-foreground group-hover:text-foreground",
          "sr-only",
          expanded && "lg:not-sr-only lg:relative",
        )}
      >
        {label}
      </span>
    </>
  );
}

const RAIL_ROW =
  "group relative flex h-10 items-center gap-3 rounded-lg px-3 outline-none focus-visible:ring-2 focus-visible:ring-ring";

function NavRail({
  expanded,
  onToggle,
  onUpload,
}: {
  expanded: boolean;
  onToggle: () => void;
  onUpload: () => void;
}) {
  const reduce = useReducedMotion() ?? false;
  return (
    <aside
      className={cn(
        "glass sticky top-14 z-30 flex h-[calc(100vh-3.5rem)] shrink-0 flex-col gap-1 border-r p-2.5",
        HAIRLINE,
        "w-[4.25rem] transition-[width] duration-300 [transition-timing-function:var(--ease-standard)]",
        expanded && "lg:w-60",
      )}
    >
      <nav className="flex flex-col gap-1">
        {NAV.map((item) => (
          <NavLink key={item.to} to={item.to} end={item.end} title={item.label} className={RAIL_ROW}>
            {({ isActive }) => (
              <RailRowInner
                icon={item.icon}
                label={item.label}
                active={isActive}
                expanded={expanded}
                reduce={reduce}
              />
            )}
          </NavLink>
        ))}
        <button type="button" onClick={onUpload} title="Upload dataset" className={RAIL_ROW}>
          <RailRowInner icon={Upload} label="Upload" expanded={expanded} reduce={reduce} />
        </button>
      </nav>

      <button
        type="button"
        onClick={onToggle}
        aria-label={expanded ? "Collapse sidebar" : "Expand sidebar"}
        aria-pressed={expanded}
        className={cn(RAIL_ROW, "mt-auto hidden text-muted-foreground hover:text-foreground lg:flex")}
      >
        {expanded ? (
          <PanelLeftClose aria-hidden="true" className="relative z-10 h-[18px] w-[18px] shrink-0" strokeWidth={2.1} />
        ) : (
          <PanelLeft aria-hidden="true" className="relative z-10 h-[18px] w-[18px] shrink-0" strokeWidth={2.1} />
        )}
        <span className={cn("relative z-10 whitespace-nowrap text-[13px] font-medium", expanded ? "lg:inline" : "sr-only")}>
          Collapse
        </span>
      </button>
    </aside>
  );
}

// ---- Upload modal (reuses the existing UploadDropzone pipeline) -----------
function UploadModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const reduce = useReducedMotion() ?? false;
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    ref.current?.focus();
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-50 flex items-start justify-center p-4 pt-[12vh]"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: reduce ? 0 : 0.18 }}
        >
          <div className="absolute inset-0 bg-background/60 backdrop-blur-sm" onClick={onClose} aria-hidden="true" />
          <motion.div
            ref={ref}
            role="dialog"
            aria-modal="true"
            aria-label="Upload dataset"
            tabIndex={-1}
            initial={{ opacity: 0, scale: reduce ? 1 : 0.96, y: reduce ? 0 : 8 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: reduce ? 1 : 0.98, y: reduce ? 0 : 6 }}
            transition={reduce ? { duration: 0 } : springs.instant}
            className={cn("glass relative z-10 w-full max-w-lg rounded-2xl border p-5 outline-none", HAIRLINE)}
          >
            <div className="mb-4 flex items-start justify-between gap-4">
              <div>
                <h2 className="text-[15px] font-semibold tracking-tight text-foreground">Upload a dataset</h2>
                <p className="text-pretty text-[13px] text-muted-foreground">
                  CSV or XLSX — profiled, classified and scored the moment it lands.
                </p>
              </div>
              <button
                type="button"
                onClick={onClose}
                aria-label="Close"
                className="grid h-8 w-8 shrink-0 place-items-center rounded-md text-muted-foreground outline-none transition-colors hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
              >
                <X aria-hidden="true" className="h-4 w-4" />
              </button>
            </div>
            <UploadDropzone />
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

// ---- Shell ---------------------------------------------------------------
function readSidebarPref(): boolean {
  if (typeof window === "undefined") return true;
  try {
    return localStorage.getItem(SIDEBAR_KEY) !== "collapsed";
  } catch {
    return true;
  }
}

export function AppShell() {
  const [uploadOpen, setUploadOpen] = useState(false);
  const [expanded, setExpanded] = useState(readSidebarPref);
  const location = useLocation();
  const reduce = useReducedMotion() ?? false;

  function toggleSidebar() {
    setExpanded((v) => {
      const next = !v;
      try {
        localStorage.setItem(SIDEBAR_KEY, next ? "expanded" : "collapsed");
      } catch {
        /* private mode — best effort */
      }
      return next;
    });
  }

  return (
    <div className="relative min-h-screen bg-background text-foreground">
      <CursorSpotlight />
      <TopBar onUpload={() => setUploadOpen(true)} />

      <div className="relative z-10 flex">
        <NavRail expanded={expanded} onToggle={toggleSidebar} onUpload={() => setUploadOpen(true)} />
        <main className="min-w-0 flex-1">
          <AnimatePresence mode="wait">
            <motion.div
              key={location.pathname}
              initial={{ opacity: 0, y: reduce ? 0 : 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: reduce ? 0 : -6 }}
              transition={{ duration: reduce ? 0 : motionTokens.duration.normal, ease: motionTokens.ease }}
            >
              <Outlet />
            </motion.div>
          </AnimatePresence>
        </main>
      </div>

      <UploadModal open={uploadOpen} onClose={() => setUploadOpen(false)} />
    </div>
  );
}
