import { BrowserRouter, Route, Routes } from "react-router-dom";
import { AppShell } from "@/components/shell/AppShell";
import { DashboardPage } from "@/pages/DashboardPage";
import { CatalogPage } from "@/pages/CatalogPage";
import { DatasetDetailPage } from "@/pages/DatasetDetailPage";
import { SettingsPage } from "@/pages/SettingsPage";
import { NotFoundPage } from "@/pages/NotFoundPage";

export function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route element={<AppShell />}>
          <Route path="/" element={<DashboardPage />} />
          <Route path="/catalog" element={<CatalogPage />} />
          <Route path="/datasets/:id" element={<DatasetDetailPage />} />
          <Route path="/settings" element={<SettingsPage />} />
          {/* Inside the layout route on purpose: an unmatched URL keeps the nav. */}
          <Route path="*" element={<NotFoundPage />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
