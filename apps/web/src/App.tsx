import { BrowserRouter, Route, Routes } from "react-router-dom";
import { CatalogPage } from "@/pages/CatalogPage";
import { DatasetDetailPage } from "@/pages/DatasetDetailPage";

export function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<CatalogPage />} />
        <Route path="/datasets/:id" element={<DatasetDetailPage />} />
      </Routes>
    </BrowserRouter>
  );
}
