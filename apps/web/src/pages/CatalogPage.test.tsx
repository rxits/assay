// 08 §5 Test A — the catalog binds and renders rows from GET /api/datasets.
import { http, HttpResponse } from "msw";
import { screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { DatasetSummary } from "@assay/shared";
import { renderWithProviders } from "@/test/utils";
import { server } from "@/test/server";
import { CatalogPage } from "./CatalogPage";

function summary(over: Partial<DatasetSummary>): DatasetSummary {
  return {
    id: "x",
    name: "x.csv",
    originalFilename: "x.csv",
    fileType: "CSV",
    sizeBytes: 1000,
    rowCount: 100,
    columnCount: 4,
    status: "READY",
    qualityScore: 90,
    trustScore: 90,
    valueScore: 90,
    valueRecommendation: "KEEP",
    piiColumnCount: 0,
    highestSensitivity: "NONE",
    lastAccessedAt: "2026-07-20T10:00:00.000Z",
    errorMessage: null,
    uploadedAt: "2026-07-18T10:00:00.000Z",
    updatedAt: "2026-07-18T10:00:00.000Z",
    ...over,
  };
}

describe("CatalogPage", () => {
  it("lists datasets from the API with their scores", async () => {
    const rows = [
      summary({ id: "1", name: "customers.csv", qualityScore: 92, trustScore: 88, valueScore: 71, highestSensitivity: "HIGH" }),
      summary({ id: "2", name: "events_log.csv", qualityScore: 90, trustScore: 86, valueScore: 95, highestSensitivity: "NONE" }),
    ];
    server.use(
      http.get("*/api/datasets", () =>
        HttpResponse.json({ data: rows, meta: { total: 2, limit: 20, offset: 0, count: 2 } }),
      ),
    );

    renderWithProviders(<CatalogPage />);

    // The desktop table appears once the query resolves.
    const table = await screen.findByRole("table");
    expect(within(table).getByText("customers.csv")).toBeInTheDocument();
    expect(within(table).getByText("events_log.csv")).toBeInTheDocument();

    // Header row + 2 data rows.
    expect(within(table).getAllByRole("row")).toHaveLength(3);

    // Each row renders three score meters (Quality / Trust / Value).
    expect(within(table).getAllByRole("meter")).toHaveLength(6);
    expect(within(table).getByText("92")).toBeInTheDocument();

    // The count reflects meta.total.
    expect(screen.getByRole("heading", { name: /catalog/i })).toBeInTheDocument();
    expect(screen.getByText(/2 datasets/i)).toBeInTheDocument();
  });
});
