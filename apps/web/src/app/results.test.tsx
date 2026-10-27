import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import Dashboard from "./screens/Dashboard";
import { FIXTURE_RESULT, makeFixtureResult } from "./fixtures/analysisResult";
import type { TabId } from "./tabIds";
import { useState } from "react";
import type { AnalysisResult } from "../engine";

vi.mock("./echartsSetup", () => ({
  init: () => ({ setOption: vi.fn(), resize: vi.fn(), dispose: vi.fn() }),
}));

function Harness({
  result = FIXTURE_RESULT,
  start = "overview",
}: {
  result?: AnalysisResult;
  start?: TabId;
}) {
  const [tab, setTab] = useState<TabId>(start);
  return <Dashboard result={result} tab={tab} onTab={setTab} onStartOver={vi.fn()} />;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("Dashboard", () => {
  it("shows the context bar with dataset, synthetic badge, scoring date, horizon and model", () => {
    render(<Harness />);
    const bar = screen.getByRole("region", { name: /about these numbers/i });
    expect(within(bar).getByText("SYNTHETIC")).toBeInTheDocument();
    expect(within(bar).getByText(/9 Dec 2011/)).toBeInTheDocument();
    expect(within(bar).getByText("60 days")).toBeInTheDocument();
    expect(within(bar).getByText("Random forest")).toBeInTheDocument();
  });

  it("has an ARIA tablist and switches panels with the keyboard", () => {
    render(<Harness />);
    const tabs = screen.getAllByRole("tab");
    expect(tabs).toHaveLength(6);
    expect(screen.getByRole("tab", { name: "Overview" })).toHaveAttribute("aria-selected", "true");
    fireEvent.keyDown(screen.getByRole("tablist"), { key: "ArrowRight" });
    expect(screen.getByRole("tab", { name: "Data quality" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(screen.getByRole("tabpanel")).toHaveAttribute("aria-labelledby", "results-quality");
  });

  it("overview shows fixture KPI numbers", () => {
    render(<Harness />);
    expect(screen.getByText("Active customers")).toBeInTheDocument();
    expect(screen.getByText("64%")).toBeInTheDocument();
    expect(screen.getByText(/revenue at risk/i)).toBeInTheDocument();
  });

  it("segments tab lists all eight segments with suggested actions", () => {
    render(<Harness start="segments" />);
    expect(screen.getAllByText(/suggested action/i).length).toBeGreaterThanOrEqual(8);
    expect(screen.getByText(/agreement score \(ari\): 0\.46/i)).toBeInTheDocument();
  });

  it("data quality tab shows reconciliation and warnings", () => {
    render(<Harness start="quality" />);
    expect(screen.getByText(/balances ✓/i, { selector: "p" })).toBeInTheDocument();
    expect(screen.getByText(/7\.5% of rows have no customer ID/)).toBeInTheDocument();
    expect(screen.getAllByText("R4").length).toBeGreaterThan(0);
  });

  it("threshold slider changes precision and recall", () => {
    render(<Harness start="predictions" />);
    const slider = screen.getByLabelText(/count customers as/i);
    const read = () => {
      const dts = screen.getAllByText(/^Precision \(of those flagged/);
      return dts[0]?.nextElementSibling?.textContent ?? "";
    };
    fireEvent.change(slider, { target: { value: "0.2" } });
    const lowPrecision = read();
    const lowRecall = screen.getByText(/^Recall \(of those who return/).nextElementSibling
      ?.textContent;
    fireEvent.change(slider, { target: { value: "0.8" } });
    expect(read()).not.toBe(lowPrecision);
    expect(
      screen.getByText(/^Recall \(of those who return/).nextElementSibling?.textContent,
    ).not.toBe(lowRecall);
  });

  it("predictions tab explains the protocol and compares with the baseline", () => {
    render(<Harness start="predictions" />);
    expect(screen.getByText(/simple recency rule captured/i)).toBeInTheDocument();
    expect(screen.getByText(/no random splits/i)).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: /validation period/i })).toBeInTheDocument();
  });

  it("shows the model_gain_low message in plain words", () => {
    render(
      <Harness
        result={{ ...makeFixtureResult({ gainLow: true }), flags: ["model_gain_low"] }}
        start="predictions"
      />,
    );
    expect(screen.getByText(/adds little over a simple rule/i)).toBeInTheDocument();
  });

  it("explains skipped predictions", () => {
    const skipped: AnalysisResult = {
      ...FIXTURE_RESULT,
      protocol: null,
      predictionSkipped: { code: "INSUFFICIENT_HISTORY", message: "Only 3 months of history." },
    };
    render(<Harness result={skipped} start="predictions" />);
    expect(screen.getByText(/only 3 months of history/i)).toBeInTheDocument();
  });

  it("every chart offers a View as table alternative", async () => {
    render(<Harness />);
    const buttons = screen.getAllByRole("button", { name: /view as table/i });
    expect(buttons.length).toBeGreaterThanOrEqual(5);
    fireEvent.click(buttons[0] as HTMLElement);
    expect(await screen.findAllByRole("columnheader", { name: "Month" })).not.toHaveLength(0);
  });

  it("customers tab filters, paginates and opens a drawer with drivers", async () => {
    render(<Harness start="customers" />);
    expect(screen.getByRole("status")).toHaveTextContent(/62 customers match/);
    fireEvent.change(screen.getByLabelText(/^segment$/i), { target: { value: "champions" } });
    await waitFor(() => {
      expect(screen.getByRole("status")).toHaveTextContent(/6 customers match/);
    });
    const open = screen.getAllByRole("button", {
      name: /open details for customer/i,
    })[0] as HTMLElement;
    fireEvent.click(open);
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText(/why this score/i)).toBeInTheDocument();
    expect(within(dialog).getAllByRole("listitem").length).toBe(3);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});

describe("Export tab", () => {
  function captureDownload() {
    let blob: Blob | null = null;
    vi.spyOn(URL, "createObjectURL").mockImplementation((b) => {
      blob = b as Blob;
      return "blob:test";
    });
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    return async () => (blob ? await blob.text() : "");
  }

  it("previews the filtered count and downloads only matching rows, with injection protection", async () => {
    const read = captureDownload();
    render(<Harness start="export" />);
    expect(screen.getByText(/62 customers in this list/)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(/^segment$/i), { target: { value: "champions" } });
    expect(screen.getByText(/6 customers in this list/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /download csv/i }));
    const text = await read();
    const lines = text.replace("﻿", "").trim().split("\r\n");
    expect(lines).toHaveLength(7); // header + 6 champions
    expect(text).toContain("'=HYPERLINK");
    expect(lines.slice(1).every((l) => l.includes("Champions"))).toBe(true);
  });
});
