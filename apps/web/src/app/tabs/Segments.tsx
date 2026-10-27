import { useMemo } from "react";
import type { CSSProperties } from "react";
import type { AnalysisResult } from "../../engine";
import { axisStyle, useChartColors } from "../chartTheme";
import { COPY } from "../copy";
import { fmtDec, fmtInt, fmtPct, fmtPoints } from "../format";
import { CLUSTER_COLORS, SEGMENTS, clusterLabel, segmentAction, segmentMeta } from "../meta";
import { useMoney } from "../moneyContext";
import { Alert, Pill, SegmentPill } from "../ui/basics";
import { Chart } from "../ui/Chart";
import { DataTable } from "../ui/DataTable";

export function Segments({ result }: { result: AnalysisResult }) {
  const money = useMoney();
  const c = useChartColors();
  const ax = axisStyle(c);
  const { segments, clusters, kmeans } = result;
  const horizon = result.protocol?.horizonDays ?? 60;

  const treemapOpt = useMemo(
    () => ({
      tooltip: {
        formatter: (p: { name: string; value: number }) =>
          `${p.name}: ${fmtPoints(p.value, 1)} of revenue`,
      },
      series: [
        {
          type: "treemap",
          roam: false,
          nodeClick: false,
          breadcrumb: { show: false },
          width: "100%",
          height: "100%",
          label: {
            show: true,
            formatter: "{b}",
            color: "#fff",
            fontWeight: 700,
            overflow: "break",
          },
          itemStyle: { borderColor: c.surface, borderWidth: 2, gapWidth: 2 },
          data: SEGMENTS.map((m) => {
            const s = segments.find((x) => x.key === m.key);
            return {
              name: `${m.icon} ${s?.name ?? m.name}`,
              value: Math.max(s?.revenuePct ?? 0, 0.2),
              itemStyle: { color: m.color },
            };
          }),
        },
      ],
    }),
    [segments, c.surface],
  );

  const elbowOpt = useMemo(
    () =>
      kmeans
        ? {
            grid: { left: 60, right: 56, top: 40, bottom: 40 },
            legend: { top: 0, textStyle: { color: c.text } },
            tooltip: { trigger: "axis" },
            xAxis: {
              type: "category",
              name: "Number of groups (k)",
              nameLocation: "middle",
              nameGap: 26,
              data: kmeans.tried.map((t) => String(t.k)),
              ...ax,
            },
            yAxis: [
              { type: "value", name: "Spread within groups", ...ax },
              { type: "value", name: "Fit (silhouette)", ...ax, splitLine: { show: false } },
            ],
            series: [
              {
                name: "Spread within groups (inertia)",
                type: "line",
                data: kmeans.tried.map((t) => t.inertia),
                symbol: "circle",
                symbolSize: 8,
                itemStyle: { color: "#4f46e5" },
              },
              {
                name: "Fit (silhouette)",
                type: "line",
                yAxisIndex: 1,
                data: kmeans.tried.map((t) => t.silhouette),
                symbol: "diamond",
                symbolSize: 9,
                lineStyle: { type: "dashed" },
                itemStyle: { color: "#D55E00" },
              },
            ],
          }
        : {},
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [kmeans, c],
  );

  const crossMax = useMemo(() => {
    if (!kmeans) return 1;
    return Math.max(1, ...Object.values(kmeans.crosstab).flat());
  }, [kmeans]);

  const ari = kmeans?.adjustedRandIndexVsRfm ?? 0;
  const agreement = ari >= 0.5 ? "broadly agree" : ari >= 0.25 ? "partly agree" : "mostly disagree";

  return (
    <div className="stack">
      <div>
        <h2 className="section-title" style={{ marginTop: 0 }}>
          {COPY.segments.rfmTitle}
        </h2>
        <p className="muted">{COPY.segments.rfmHelp}</p>
      </div>

      <div className="grid grid-3">
        {SEGMENTS.map((m) => {
          const s = segments.find((x) => x.key === m.key);
          const style = { ["--seg" as string]: m.color } as CSSProperties;
          return (
            <article
              key={m.key}
              className="card seg-card"
              style={style}
              aria-labelledby={`seg-${m.key}`}
            >
              <h3 id={`seg-${m.key}`}>
                <span className="seg-swatch" aria-hidden="true" />
                <span aria-hidden="true" style={{ color: m.color }}>
                  {m.icon}
                </span>
                {s?.name ?? m.name}
              </h3>
              <p className="muted small">{s?.description ?? m.blurb}</p>
              <dl className="kv" style={{ margin: "10px 0" }}>
                <dt>Customers</dt>
                <dd>
                  {fmtInt(s?.customers ?? 0)} ({fmtPoints(s?.customersPct ?? 0, 0)})
                </dd>
                <dt>Share of revenue</dt>
                <dd>{fmtPoints(s?.revenuePct ?? 0, 1)}</dd>
                <dt>Avg chance to buy again ({horizon} days)</dt>
                <dd>{fmtPct(s?.avgPRepeat ?? 0, 0)}</dd>
              </dl>
              <p>
                <strong>Suggested action: </strong>
                {segmentAction(m.key, segments)}
              </p>
            </article>
          );
        })}
      </div>

      <div className="card">
        <Chart
          title="Revenue by RFM segment (bigger box = more revenue)"
          option={treemapOpt}
          height={300}
          ariaLabel="Treemap of the share of revenue by RFM segment"
          tableData={{
            columns: ["Segment", "Customers", "Share of revenue", "Revenue"],
            rows: SEGMENTS.map((m) => {
              const s = segments.find((x) => x.key === m.key);
              return [
                s?.name ?? m.name,
                fmtInt(s?.customers ?? 0),
                fmtPoints(s?.revenuePct ?? 0, 1),
                money.full(s?.revenue ?? 0),
              ];
            }),
          }}
        />
      </div>

      <section aria-labelledby="km-h">
        <h2 id="km-h" className="section-title">
          {COPY.segments.clustersTitle}
        </h2>
        <p className="muted" style={{ marginBottom: 10 }}>
          {COPY.segments.clustersHelp}
        </p>
        {clusters.length === 0 ? (
          <Alert tone="info">Not enough data to find groups automatically.</Alert>
        ) : (
          <DataTable
            caption="K-means groups: size, revenue and typical behaviour"
            hideCaption
            rows={clusters}
            rowKey={(r) => String(r.cluster)}
            columns={[
              {
                key: "name",
                header: "Group",
                rowHeader: true,
                render: (r) => (
                  <span>
                    <span
                      aria-hidden="true"
                      style={{ color: CLUSTER_COLORS[r.cluster % CLUSTER_COLORS.length] }}
                    >
                      ■{" "}
                    </span>
                    <strong>{clusterLabel(r)}</strong>
                  </span>
                ),
              },
              {
                key: "size",
                header: "Customers",
                numeric: true,
                render: (r) => `${fmtInt(r.size)} (${fmtPoints(r.sizePct, 0)})`,
              },
              {
                key: "rev",
                header: "Revenue share",
                numeric: true,
                render: (r) => fmtPoints(r.revenuePct, 1),
              },
              {
                key: "rec",
                header: "Median days since order",
                numeric: true,
                render: (r) => fmtDec(r.medianRecencyDays, 1),
              },
              {
                key: "freq",
                header: "Median orders",
                numeric: true,
                render: (r) => fmtDec(r.medianFrequency, 1),
              },
              {
                key: "mon",
                header: "Median spend",
                numeric: true,
                render: (r) => money.full(r.medianMonetary),
              },
              {
                key: "p",
                header: `Avg chance to buy again`,
                numeric: true,
                render: (r) => fmtPct(r.avgPRepeat, 0),
              },
              {
                key: "dom",
                header: "Mostly",
                render: (r) => <SegmentPill segment={r.dominantSegment} />,
              },
            ]}
          />
        )}
      </section>

      {kmeans ? (
        <div className="grid grid-2">
          <section className="card" aria-labelledby="xt-h">
            <h3 id="xt-h">{COPY.segments.crosstab}</h3>
            <p className="muted small" style={{ marginBottom: 8 }}>
              Each row is an RFM segment, each column a K-means group. Darker cells hold more
              customers.
            </p>
            <div
              className="table-wrap"
              tabIndex={0}
              role="region"
              aria-label="RFM segments by K-means groups"
            >
              <table className="data">
                <caption className="sr-only">Customers per RFM segment and K-means group</caption>
                <thead>
                  <tr>
                    <th scope="col">Segment</th>
                    {clusters.map((cl) => (
                      <th key={cl.cluster} scope="col" className="num" title={clusterLabel(cl)}>
                        Group {cl.cluster + 1}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {SEGMENTS.map((m) => (
                    <tr key={m.key}>
                      <th scope="row">{segmentMeta(m.key).name}</th>
                      {clusters.map((cl, i) => {
                        const v = kmeans.crosstab[m.key]?.[i] ?? 0;
                        return (
                          <td
                            key={cl.cluster}
                            className="num"
                            style={{
                              background: `color-mix(in srgb, var(--brand) ${String(Math.round((v / crossMax) * 55))}%, transparent)`,
                            }}
                          >
                            {fmtInt(v)}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p style={{ marginTop: 10 }}>
              <Pill tone="vio">Agreement score (ARI): {fmtDec(ari, 2)}</Pill>{" "}
              <span className="muted small">
                1 = identical groupings, 0 = no more alike than chance. The two methods {agreement}.
              </span>
            </p>
          </section>
          <section className="card">
            <Chart
              title={COPY.segments.elbow}
              subtitle={`We chose ${String(kmeans.k)} groups (fit score ${fmtDec(kmeans.silhouette, 2)}). Look for where the line stops dropping quickly and the dashed fit line peaks.`}
              option={elbowOpt}
              ariaLabel="Line chart of K-means spread and silhouette score for each number of groups"
              tableData={{
                columns: ["Groups (k)", "Spread (inertia)", "Fit (silhouette)"],
                rows: kmeans.tried.map((t) => [
                  String(t.k),
                  fmtDec(t.inertia, 1),
                  fmtDec(t.silhouette, 2),
                ]),
              }}
            />
          </section>
        </div>
      ) : null}

      <Alert tone="info" title={COPY.segments.trust}>
        {COPY.segments.trustBody}
      </Alert>
    </div>
  );
}
