import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { AnalysisOptions, MappingSuggestion, RawTable } from "../../engine";
import { MappingScreen } from "./MappingScreen";

const table: RawTable = {
  name: "orders.csv",
  columns: ["Invoice", "When", "Cust", "Qty", "Price"],
  rows: Array.from({ length: 12 }, (_, i) => [
    `I${String(i)}`,
    "2011-01-01",
    `C${String(i)}`,
    "1",
    "2.5",
  ]),
};
const defaults: AnalysisOptions = { cancellationMode: "net", dateOrder: "auto", horizonDays: 60 };
const sug = (over: Record<string, string | null>): MappingSuggestion[] =>
  [
    ["invoice_id", "Invoice"],
    ["invoice_ts", "When"],
    ["customer_ref", "Cust"],
    ["quantity", "Qty"],
    ["unit_price", "Price"],
  ].map(([field, column]) => ({
    field: field as MappingSuggestion["field"],
    column: field && field in over ? (over[field] ?? null) : (column ?? null),
    confidence: 0.9,
  }));

describe("MappingScreen", () => {
  it("disables Run until every required field is mapped", () => {
    const onRun = vi.fn();
    render(
      <MappingScreen
        table={table}
        suggestions={sug({ customer_ref: null })}
        defaults={defaults}
        onRun={onRun}
        onBack={vi.fn()}
      />,
    );
    const run = screen.getByRole("button", { name: /run analysis/i });
    expect(run).toBeDisabled();
    expect(screen.getByText(/still needed: customer id/i)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(/customer id/i), { target: { value: "Cust" } });
    expect(run).toBeEnabled();
    fireEvent.click(run);
    expect(onRun).toHaveBeenCalledWith(
      expect.objectContaining({ customer_ref: "Cust" }),
      expect.objectContaining({ horizonDays: 60 }),
    );
  });

  it("shows a 10-row preview and passes changed options", () => {
    const onRun = vi.fn();
    render(
      <MappingScreen
        table={table}
        suggestions={sug({})}
        defaults={defaults}
        onRun={onRun}
        onBack={vi.fn()}
      />,
    );
    expect(screen.getByRole("table").querySelectorAll("tbody tr")).toHaveLength(10);
    fireEvent.click(screen.getByRole("radio", { name: "90 days" }));
    fireEvent.click(screen.getByRole("checkbox", { name: /leave out wholesale/i }));
    fireEvent.click(screen.getByRole("button", { name: /run analysis/i }));
    expect(onRun).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ horizonDays: 90, excludeWholesale: true }),
    );
  });

  it("flags required fields and confidence", () => {
    render(
      <MappingScreen
        table={table}
        suggestions={sug({})}
        defaults={defaults}
        onRun={vi.fn()}
        onBack={vi.fn()}
      />,
    );
    expect(screen.getAllByText("Required").length).toBe(5);
    expect(screen.getAllByText("Good match").length).toBe(5);
  });
});
