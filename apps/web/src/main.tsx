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
const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
});

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </StrictMode>,
);
