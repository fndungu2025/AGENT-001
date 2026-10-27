import { useMemo } from "react";
import type { AnalysisResult } from "../../engine";
import { axisStyle, useChartColors } from "../chartTheme";
import { COPY } from "../copy";
import { fmtInt, fmtPct, fmtPoints } from "../format";
import { BANDS, SEGMENTS, segmentMeta } from "../meta";
import { useMoney } from "../moneyContext";
import type { TabId } from "../tabIds";
import { Alert, KpiTile } from "../ui/basics";
import { Chart } from "../ui/Chart";

export function Overview({ result, onTab }: { result: AnalysisResult; onTab: (t: TabId) => void }) {
  const money = useMoney();
  const c = useChartColors();
  const ax = axisStyle(c);
  const { kpis, monthly, segments, customers } = result;
  const horizon = result.protocol?.horizonDays ?? 60;

  const monthlyOpt = useMemo(
    () => ({
      grid: { left: 64, right: 56, top: 40, bottom: 40 },
      legend: { top: 0, textStyle: { color: c.text } },
      tooltip: { trigger: "axis" },
      xAxis: { type: "category", data: monthly.map((m) => m.month), ...ax },
      yAxis: [
        {
          type: "value",
          name: "Revenue",
          ...ax,
          axisLabel: { color: c.muted, formatter: (v: number) => money.short(v) },
        },
        { type: "value", name: "Orders", ...ax, splitLine: { show: false } },
      ],
      series: [
        {
          name: "Revenue",
          type: "bar",
          data: monthly.map((m) => m.revenue),
          itemStyle: { color: "#4f46e5" },
        },
        {
          name: "Orders",
          type: "line",
          yAxisIndex: 1,
          data: monthly.map((m) => m.orders),
          symbol: "diamond",
          symbolSize: 7,
          itemStyle: { color: "#E69F00" },
          lineStyle: { color: "#E69F00", width: 2.5 },
        },
      ],
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [monthly, c, money],
  );

  const segData = useMemo(
    () =>
      SEGMENTS.map((m) => {
        const s = segments.find((x) => x.key === m.key);
        return {
          key: m.key,
          name: s?.name ?? m.name,
          color: m.color,
          revenuePct: (s?.revenuePct ?? 0) / 100,
          customers: s?.customers ?? 0,
        };
      }),
    [segments],
  );

  const hbar = (
    rows: { name: string; value: number; color: string }[],
    fmt: (v: number) => string,
  ) => ({
    grid: { left: 8, right: 56, top: 8, bottom: 8, containLabel: true },
    tooltip: {
      trigger: "item",
      formatter: (p: { name: string; value: number }) => `${p.name}: ${fmt(p.value)}`,
    },
    xAxis: {
      type: "value",
      ...ax,
      axisLabel: { color: c.muted, formatter: (v: number) => fmt(v) },
    },
    yAxis: {
      type: "category",
      inverse: true,
      data: rows.map((r) => r.name),
      ...ax,
      axisLabel: { color: c.text },
    },
    series: [
      {
        type: "bar",
        data: rows.map((r) => ({ value: r.value, itemStyle: { color: r.color } })),
        label: {
          show: true,
          position: "right",
          color: c.text,
          formatter: (p: { value: number }) => fmt(p.value),
        },
      },
    ],
  });

  const revByseg = useMemo(
    () =>
      hbar(
        [...segData]
          .sort((a, b) => b.revenuePct - a.revenuePct)
          .map((s) => ({ name: s.name, value: s.revenuePct, color: s.color })),
        (v) => fmtPct(v, 0),
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [segData, c],
  );
  const custBySeg = useMemo(
    () =>
      hbar(
        [...segData]
          .sort((a, b) => b.customers - a.customers)
          .map((s) => ({ name: s.name, value: s.customers, color: s.color })),
        (v) => fmtInt(v),
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [segData, c],
  );

  const hist = useMemo(() => {
    const bins = Array.from({ length: 10 }, () => ({ high_chance: 0, medium: 0, low_chance: 0 }));
    for (const cu of customers) {
      const i = Math.min(9, Math.max(0, Math.floor(cu.pRepeat * 10)));
      const b = bins[i];
      if (b) b[cu.riskBand] += 1;
    }
    return bins;
  }, [customers]);
  const histLabels = hist.map((_, i) => `${String(i * 10)}–${String((i + 1) * 10)}%`);
  const histOpt = useMemo(
    () => ({
      grid: { left: 48, right: 12, top: 40, bottom: 56 },
      legend: { top: 0, textStyle: { color: c.text } },
      tooltip: { trigger: "axis", axisPointer: { type: "shadow" } },
      xAxis: {
        type: "category",
        data: histLabels,
        name: "Chance of buying again",
        nameLocation: "middle",
        nameGap: 34,
        ...ax,
      },
      yAxis: { type: "value", name: "Customers", ...ax },
      series: [...BANDS].reverse().map((b) => ({
        name: b.label,
        type: "bar",
        stack: "n",
        data: hist.map((h) => h[b.key]),
        itemStyle: { color: b.color },
      })),
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [hist, c],
  );

  const countries = useMemo(() => {
    const m = new Map<string, number>();
    for (const cu of customers)
      m.set(cu.country || "Unknown", (m.get(cu.country || "Unknown") ?? 0) + cu.monetary);
    const sorted = [...m.entries()].sort((a, b) => b[1] - a[1]);
    const top = sorted.slice(0, 8);
    const other = sorted.slice(8).reduce((a, x) => a + x[1], 0);
    return other > 0 ? [...top, ["Other", other] as [string, number]] : top;
  }, [customers]);
  const countryOpt = useMemo(
    () =>
      hbar(
        countries.map(([name, value]) => ({ name, value, color: "#0072B2" })),
        (v) => money.short(v),
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [countries, c, money],
  );

  const atRiskCount = customers.filter(
    (x) => (x.segment === "at_risk" || x.segment === "cant_lose") && x.pRepeat < 0.3,
  ).length;

  return (
    <div className="stack">
      <section aria-labelledby="kpi-h">
        <h2 id="kpi-h" className="sr-only">
          Key numbers
        </h2>
        <div className="grid grid-kpi">
          <KpiTile
            label={COPY.kpi.active[0]}
            value={fmtInt(kpis.activeCustomers)}
            hint={COPY.kpi.active[1]}
            color="#4338ca"
          />
          <KpiTile
            label={COPY.kpi.revenue[0]}
            value={money.short(kpis.netRevenue12m)}
            hint={COPY.kpi.revenue[1]}
            color="#0f766e"
          />
          <KpiTile
            label={COPY.kpi.repeat[0]}
            value={fmtPct(kpis.repeatCustomerRate, 0)}
            hint={COPY.kpi.repeat[1]}
            color="#be185d"
          />
          <KpiTile
            label={COPY.kpi.aov[0]}
            value={money.full(kpis.avgOrderValue)}
            hint={COPY.kpi.aov[1]}
            color="#b45309"
          />
          <KpiTile
            label={`${COPY.kpi.expected[0]} (${String(horizon)} days)`}
            value={fmtInt(kpis.expectedRepeaters)}
            hint={COPY.kpi.expected[1]}
            color="#0369a1"
          />
          <KpiTile
            label={COPY.kpi.atRisk[0]}
            value={money.short(kpis.revenueAtRisk)}
            hint={COPY.kpi.atRisk[1]}
            color="#b91c1c"
          />
        </div>
      </section>

      <Alert tone="info" title="What to do next">
        <p>
          {fmtInt(atRiskCount)} high-value customers have gone quiet and have under a 30% chance of
          returning.{" "}
          <button
            type="button"
            className="link-btn"
            onClick={() => {
              onTab("export");
            }}
          >
            Build a contact list
          </button>{" "}
          or{" "}
          <button
            type="button"
            className="link-btn"
            onClick={() => {
              onTab("segments");
            }}
          >
            see the suggested action for each group
          </button>
          .
        </p>
      </Alert>

      <div className="grid grid-2">
        <div className="card">
          <Chart
            title="Revenue and orders by month"
            subtitle="Bars: revenue (left axis). Line: number of orders (right axis)."
            option={monthlyOpt}
            ariaLabel={`Monthly revenue and orders over ${String(monthly.length)} months`}
            tableData={{
              columns: ["Month", "Revenue", "Orders", "Customers"],
              rows: monthly.map((m) => [
                m.month,
                money.full(m.revenue),
                fmtInt(m.orders),
                fmtInt(m.customers),
              ]),
            }}
          />
        </div>
        <div className="card">
          <Chart
            title="Chance of buying again, by risk band"
            subtitle="How many customers sit at each score. Colours and labels show the band."
            option={histOpt}
            ariaLabel="Histogram of customers by chance of buying again, split into high, medium and low chance bands"
            tableData={{
              columns: ["Score range", "High chance", "Medium chance", "Low chance"],
              rows: hist.map((h, i) => [
                histLabels[i] ?? "",
                fmtInt(h.high_chance),
                fmtInt(h.medium),
                fmtInt(h.low_chance),
              ]),
            }}
          />
        </div>
        <div className="card">
          <Chart
            title="Share of revenue by segment"
            option={revByseg}
            height={320}
            ariaLabel="Bar chart of the share of revenue each customer segment contributes"
            tableData={{
              columns: ["Segment", "Share of revenue"],
              rows: segData.map((s) => [s.name, fmtPct(s.revenuePct, 1)]),
            }}
          />
        </div>
        <div className="card">
          <Chart
            title="Customers by segment"
            option={custBySeg}
            height={320}
            ariaLabel="Bar chart of the number of customers in each segment"
            tableData={{
              columns: ["Segment", "Customers"],
              rows: segData.map((s) => [s.name, fmtInt(s.customers)]),
            }}
          />
        </div>
        <div className="card">
          <Chart
            title="Top countries by revenue"
            option={countryOpt}
            height={320}
            ariaLabel="Bar chart of revenue by country, top eight plus other"
            tableData={{
              columns: ["Country", "Revenue"],
              rows: countries.map(([n, v]) => [n, money.full(v)]),
            }}
          />
        </div>
        <div className="card">
          <h3>Segments at a glance</h3>
          <ul className="muted" style={{ paddingLeft: 18, marginTop: 8 }}>
            {SEGMENTS.map((m) => {
              const s = segments.find((x) => x.key === m.key);
              return (
                <li key={m.key} style={{ margin: "4px 0" }}>
                  <span style={{ color: segmentMeta(m.key).color }} aria-hidden="true">
                    {m.icon}{" "}
                  </span>
                  <strong style={{ color: "var(--text)" }}>{s?.name ?? m.name}</strong>:{" "}
                  {fmtInt(s?.customers ?? 0)} customers, {fmtPoints(s?.revenuePct ?? 0, 0)} of
                  revenue
                </li>
              );
            })}
          </ul>
        </div>
      </div>
    </div>
  );
}
