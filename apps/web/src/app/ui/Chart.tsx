import type { EChartsCoreOption, EChartsType } from "echarts/core";
import { useEffect, useId, useRef, useState } from "react";
import { prefersReducedMotion, useChartColors } from "../chartTheme";
import { COPY } from "../copy";

export interface TableData {
  columns: string[];
  rows: (string | number)[][];
}

interface Props {
  title: string;
  subtitle?: string | undefined;
  option: EChartsCoreOption;
  ariaLabel: string;
  tableData: TableData;
  height?: number;
}

/** ECharts wrapper: lazy init, resize observer, dispose, aria on, reduced-motion aware, with a
 *  "View as table" alternative for every chart. */
export function Chart({ title, subtitle, option, ariaLabel, tableData, height = 300 }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const instance = useRef<EChartsType | null>(null);
  const [failed, setFailed] = useState(false);
  const [ready, setReady] = useState(false);
  const [asTable, setAsTable] = useState(false);
  const colors = useChartColors();
  const headingId = useId();
  const tableId = useId();

  useEffect(() => {
    let disposed = false;
    let ro: ResizeObserver | null = null;
    const el = ref.current;
    if (!el) return;
    import("../echartsSetup")
      .then(({ init }) => {
        if (disposed) return;
        const chart = init(el, undefined, { renderer: "canvas" });
        instance.current = chart;
        setReady(true);
        const resize = () => {
          chart.resize();
        };
        if (typeof ResizeObserver !== "undefined") {
          ro = new ResizeObserver(resize);
          ro.observe(el);
        } else {
          window.addEventListener("resize", resize);
        }
      })
      .catch(() => {
        if (!disposed) setFailed(true);
      });
    return () => {
      disposed = true;
      ro?.disconnect();
      instance.current?.dispose();
      instance.current = null;
    };
  }, []);

  useEffect(() => {
    const chart = instance.current;
    const apply = (c: EChartsType) => {
      c.setOption(
        {
          animation: !prefersReducedMotion(),
          aria: { enabled: true, decal: { show: true } },
          backgroundColor: "transparent",
          textStyle: { color: colors.text },
          ...option,
        },
        true,
      );
    };
    if (chart) apply(chart);
  }, [option, colors, ready]);

  return (
    <figure className="chart-frame" style={{ margin: 0 }} aria-labelledby={headingId}>
      <div className="chart-head">
        <div>
          <h3 id={headingId}>{title}</h3>
          {subtitle ? <p className="muted small">{subtitle}</p> : null}
        </div>
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          aria-pressed={asTable}
          aria-controls={tableId}
          onClick={() => {
            setAsTable((v) => !v);
          }}
        >
          {asTable ? COPY.chart.viewChart : COPY.chart.viewTable}
        </button>
      </div>
      <div
        ref={ref}
        className="chart-canvas"
        role="img"
        aria-label={ariaLabel}
        style={{ height, display: asTable ? "none" : "block" }}
      />
      {failed && !asTable ? <p className="chart-fallback">{COPY.chart.failed}</p> : null}
      <div id={tableId} hidden={!asTable}>
        {asTable ? (
          <div className="table-wrap" tabIndex={0} role="region" aria-label={`${title} (table)`}>
            <table className="data">
              <caption className="sr-only">{ariaLabel}</caption>
              <thead>
                <tr>
                  {tableData.columns.map((c) => (
                    <th key={c} scope="col">
                      {c}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {tableData.rows.map((r, i) => (
                  <tr key={i}>
                    {r.map((cell, j) =>
                      j === 0 ? (
                        <th key={j} scope="row">
                          {cell}
                        </th>
                      ) : (
                        <td key={j} className="num">
                          {cell}
                        </td>
                      ),
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </div>
    </figure>
  );
}
