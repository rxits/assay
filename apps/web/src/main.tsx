import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { App } from "@/App";
import { applyPreferences } from "@/lib/preferences";
import "@/index.css";

// Theme + density + motion land on <html> before first paint, so tokens resolve
// without a flash (05 §2) and a compact table never reflows on mount.
applyPreferences();

// retry:false — a failed API call surfaces immediately (the cold-start banner /
// error state is the UX, not a silent multi-second retry loop).
//
// refetchOnWindowFocus:false is not a preference here, it is a correctness fix. Reading a
// dataset records an AccessEvent, which feeds the Value score — so with the default enabled,
// alt-tabbing back to a detail page inflated the very metric the page was reporting, and a
// dataset could climb out of RETIRE without anyone using it. staleTime keeps a remount from
// doing the same thing.
const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: false, refetchOnWindowFocus: false, staleTime: 30_000 },
    mutations: { retry: false },
  },
});

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </StrictMode>,
);
