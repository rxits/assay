// 08 §5 Test B — the "explain this score" transparency affordance. MSW stubs the
// detail + usage endpoints; clicking a score gauge opens its breakdown popover and
// the scoreBreakdown sub-scores (the same ones the scoring unit test asserts) appear.
import { http, HttpResponse } from "msw";
import { Route, Routes } from "react-router-dom";
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import type { DatasetDetail, UsageSeries } from "@assay/shared";
import { renderWithProviders } from "@/test/utils";
import { server } from "@/test/server";
import { DatasetDetailPage } from "./DatasetDetailPage";

const usage: UsageSeries = {
  datasetId: "1",
  from: "2026-04-22",
  to: "2026-07-21",
  series: [
    { date: "2026-07-19", total: 2 },
    { date: "2026-07-20", total: 3 },
    { date: "2026-07-21", total: 1 },
  ],
  summary: { accesses90d: 34, accessesLast30: 12, accessesPrev30: 9, lastAccessedAt: "2026-07-21T14:40:11.000Z" },
};

const detail: DatasetDetail = {
  id: "1",
  name: "customers.csv",
  originalFilename: "customers.csv",
  fileType: "CSV",
  sizeBytes: 48213,
  rowCount: 1000,
  columnCount: 2,
  status: "READY",
  qualityScore: 98.9,
  trustScore: 98.6,
  valueScore: 68.7,
  valueRecommendation: "KEEP",
  piiColumnCount: 1,
  highestSensitivity: "HIGH",
  lastAccessedAt: "2026-07-21T14:40:11.000Z",
  accessCount: 128,
  accessCount90d: 34,
  errorMessage: null,
  uploadedAt: "2026-07-18T10:00:00.000Z",
  updatedAt: "2026-07-18T10:00:00.000Z",
  healthNarrative: null,
  scoreBreakdown: {
    quality: {
      score: 98.9,
      inputs: { completeness: 0.98, validity: 0.99, uniqueness: 1.0 },
      weights: { completeness: 0.4, validity: 0.3, uniqueness: 0.3 },
    },
    trust: {
      score: 98.6,
      inputs: { quality: 0.989, consistency: 0.97, classificationCoverage: 1.0 },
      weights: { quality: 0.45, consistency: 0.3, classificationCoverage: 0.25 },
    },
    value: {
      score: 68.7,
      inputs: { frequency: 0.62, recency: 0.85, trend: 0.55 },
      weights: { frequency: 0.45, recency: 0.35, trend: 0.2 },
      raw: { accesses90d: 34, accessesLast30: 12, accessesPrev30: 9, daysSinceLastAccess: 0, freqCap: 50, halfLife: 30 },
    },
  },
  columns: [
    {
      id: "col-email",
      name: "email",
      position: 0,
      dataType: "STRING",
      missingCount: 3,
      missingPct: 0.003,
      distinctCount: 997,
      completeness: 0.997,
      validity: 0.999,
      sampleValues: ["ada@example.com", "grace@example.com"],
      classificationTag: {
        id: "tag-1",
        category: "EMAIL",
        sensitivity: "HIGH",
        source: "AUTO_REGEX",
        confidence: 0.99,
        overridden: false,
        createdAt: "2026-07-18T10:00:00.000Z",
        updatedAt: "2026-07-18T10:00:00.000Z",
      },
    },
    {
      id: "col-age",
      name: "age",
      position: 1,
      dataType: "INTEGER",
      missingCount: 0,
      missingPct: 0,
      distinctCount: 80,
      completeness: 1,
      validity: 1,
      sampleValues: [21, 34, 45, 52, 63],
      classificationTag: null,
    },
  ],
  qualityChecks: [],
  usage,
};

function stubDataset() {
  server.use(
    http.get("*/api/datasets/:id/usage", () => HttpResponse.json({ data: usage })),
    http.get("*/api/datasets/:id", () => HttpResponse.json({ data: detail })),
  );
}

describe("DatasetDetailPage — explain this score", () => {
  it("opens the breakdown popover with the scoreBreakdown sub-scores", async () => {
    stubDataset();
    const user = userEvent.setup();
    renderWithProviders(
      <Routes>
        <Route path="/datasets/:id" element={<DatasetDetailPage />} />
      </Routes>,
      { route: "/datasets/1" },
    );

    // The header renders once the detail resolves.
    expect(await screen.findByRole("heading", { name: "customers.csv" })).toBeInTheDocument();

    // Popover-only sub-scores are hidden until a gauge is clicked.
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.queryByText("Completeness")).not.toBeInTheDocument();

    // Click the Quality gauge (a button that opens its breakdown dialog).
    await user.click(screen.getByRole("button", { name: /quality score.*explain/i }));

    // The dialog appears with the Quality §9 sub-scores and their inputs.
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("Completeness")).toBeInTheDocument();
    expect(within(dialog).getByText("Validity")).toBeInTheDocument();
    expect(within(dialog).getByText("Uniqueness")).toBeInTheDocument();
    expect(within(dialog).getByText(/0\.40 × 0\.98/)).toBeInTheDocument();
  });

  it("surfaces Quality's completeness and accuracy inputs inside the Trust breakdown", async () => {
    stubDataset();
    const user = userEvent.setup();
    renderWithProviders(
      <Routes>
        <Route path="/datasets/:id" element={<DatasetDetailPage />} />
      </Routes>,
      { route: "/datasets/1" },
    );

    expect(await screen.findByRole("heading", { name: "customers.csv" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /trust score.*explain/i }));

    // Trust's own three weighted terms…
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("Quality")).toBeInTheDocument();
    expect(within(dialog).getByText("Consistency")).toBeInTheDocument();
    expect(within(dialog).getByText("Classification coverage")).toBeInTheDocument();
    // …plus the completeness/accuracy factors nested inside its Quality term, so
    // all five named Trust factors are accounted for (display only — the row above
    // still shows the single weighted contribution).
    expect(within(dialog).getByText("Quality inputs")).toBeInTheDocument();
    expect(within(dialog).getByText("Completeness")).toBeInTheDocument();
    expect(within(dialog).getByText("Accuracy (validity)")).toBeInTheDocument();
    expect(within(dialog).getByText("0.45 × 0.99")).toBeInTheDocument();
  });
});
