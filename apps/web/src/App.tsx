import { BrowserRouter, Route, Routes } from "react-router-dom";
import { AppShell } from "@/components/shell/AppShell";
import { DashboardPage } from "@/pages/DashboardPage";
import { CatalogPage } from "@/pages/CatalogPage";
import { DatasetDetailPage } from "@/pages/DatasetDetailPage";

export function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route element={<AppShell />}>
          <Route path="/" element={<DashboardPage />} />
          <Route path="/catalog" element={<CatalogPage />} />
          <Route path="/datasets/:id" element={<DatasetDetailPage />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
