import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { Chart } from "./Chart";

const setOption = vi.fn();
vi.mock("../echartsSetup", () => ({
  init: () => ({ setOption, resize: vi.fn(), dispose: vi.fn() }),
}));

describe("Chart", () => {
  const props = {
    title: "Sales",
    ariaLabel: "Bar chart of sales by month",
    option: { series: [] },
    tableData: {
      columns: ["Month", "Sales"],
      rows: [
        ["Jan", "10"],
        ["Feb", "20"],
      ],
    },
  };

  it("labels the chart for assistive tech and toggles a data table", () => {
    render(<Chart {...props} />);
    expect(screen.getByRole("img", { name: /bar chart of sales by month/i })).toBeInTheDocument();
    const toggle = screen.getByRole("button", { name: /view as table/i });
    expect(toggle).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(toggle);
    expect(screen.getByRole("table")).toBeInTheDocument();
    expect(screen.getByRole("rowheader", { name: "Jan" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /view as chart/i })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  it("enables the ECharts aria option and turns animation off for reduced motion", async () => {
    window.matchMedia = ((q: string) => ({
      matches: q.includes("reduced-motion"),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })) as unknown as typeof window.matchMedia;
    render(<Chart {...props} />);
    await vi.waitFor(() => {
      expect(setOption).toHaveBeenCalled();
    });
    const opt = setOption.mock.calls.at(-1)?.[0] as {
      aria: { enabled: boolean };
      animation: boolean;
    };
    expect(opt.aria.enabled).toBe(true);
    expect(opt.animation).toBe(false);
  });
});
