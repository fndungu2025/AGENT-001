import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "./App.tsx";
import { FIXTURE_RESULT } from "./app/fixtures/analysisResult";
import type { RawTable } from "./engine";

vi.mock("./app/echartsSetup", () => ({
  init: () => ({ setOption: vi.fn(), resize: vi.fn(), dispose: vi.fn() }),
}));

const sampleTable: RawTable = {
  name: "Synthetic sample shop",
  synthetic: true,
  columns: ["Invoice", "InvoiceDate", "Customer ID", "Quantity", "Price", "Country"],
  rows: [["1", "2011-01-01", "A1", "2", "3.5", "United Kingdom"]],
};

vi.mock("./engine", () => ({
  DEFAULT_OPTIONS: { cancellationMode: "net", dateOrder: "auto", horizonDays: 60 },
  parseFile: vi.fn(),
  generateSample: () => sampleTable,
  suggestMapping: (cols: string[]) => {
    const f = ["invoice_id", "invoice_ts", "customer_ref", "quantity", "unit_price", "country"];
    return f.map((field, i) => ({ field, column: cols[i] ?? null, confidence: 0.95 }));
  },
  analyzeInWorker: (_t: unknown, _m: unknown, _o: unknown, onProgress?: (p: unknown) => void) => {
    onProgress?.({ stage: "training", pct: 55, message: "Training prediction models" });
    return { promise: Promise.resolve(FIXTURE_RESULT), cancel: vi.fn() };
  },
}));

describe("App", () => {
  beforeEach(() => {
    window.location.hash = "";
  });

  it("renders landmarks, a level-1 heading and both start actions", () => {
    render(<App />);
    expect(screen.getByRole("banner")).toBeInTheDocument();
    expect(screen.getByRole("main")).toBeInTheDocument();
    expect(screen.getByRole("contentinfo")).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 1 })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /try the sample data/i })).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: /upload your orders \(csv or excel\)/i }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /choose a file/i })).toBeInTheDocument();
    expect(screen.getByText(/synthetic sample — not real customers/i)).toBeInTheDocument();
    expect(screen.getAllByText(/never leaves your browser/i).length).toBeGreaterThan(0);
  });

  it("links to the research docs and has a skip link", () => {
    render(<App />);
    expect(screen.getByRole("link", { name: /research & docs/i })).toHaveAttribute(
      "href",
      "/research/",
    );
    expect(screen.getByRole("link", { name: /skip to main content/i })).toBeInTheDocument();
  });

  it("runs the sample through to the results dashboard and switches tabs", async () => {
    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: /try the sample data/i }));
    expect(
      await screen.findByRole("tablist", { name: /results sections/i }, { timeout: 15000 }),
    ).toBeInTheDocument();
    expect(screen.getAllByText("SYNTHETIC").length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole("tab", { name: /data quality/i }));
    expect(
      (await screen.findAllByText(/balances ✓/i, {}, { timeout: 15000 })).length,
    ).toBeGreaterThan(0);
    await waitFor(
      () => {
        expect(window.location.hash).toBe("#quality");
      },
      { timeout: 15000 },
    );
  }, 60000);

  it("shows the in-app explainer from the nav", async () => {
    render(<App />);
    fireEvent.click(screen.getByRole("link", { name: /how it works/i }));
    expect(
      await screen.findByRole("heading", { level: 1, name: /how it works/i }, { timeout: 15000 }),
    ).toBeInTheDocument();
  }, 60000);
});
