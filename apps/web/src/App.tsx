import { BrowserRouter, Route, Routes } from "react-router-dom";
import { AppShell } from "@/components/shell/AppShell";
import { CatalogPage } from "@/pages/CatalogPage";
import { DatasetDetailPage } from "@/pages/DatasetDetailPage";

export function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route element={<AppShell />}>
          {/* R1.1: "/" bridges to the catalog until R1.3 mounts DashboardPage here. */}
          <Route path="/" element={<CatalogPage />} />
          <Route path="/catalog" element={<CatalogPage />} />
          <Route path="/datasets/:id" element={<DatasetDetailPage />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
