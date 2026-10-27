import { useMemo, useState } from "react";
import type { AnalysisResult, ModelMetrics, ModelResult } from "../../engine";
import { axisStyle, useChartColors } from "../chartTheme";
import type { ChartColors } from "../chartTheme";
import { COPY, MODEL_LABELS, featureLabel } from "../copy";
import { fmtDate, fmtDec, fmtInt, fmtPct } from "../format";
import { statsAtThreshold } from "../lib/threshold";
import { Alert, Pill } from "../ui/basics";
import { Chart } from "../ui/Chart";
import { DataTable } from "../ui/DataTable";

const MODEL_STYLE: Record<
  string,
  { color: string; dash: "solid" | "dashed" | "dotted"; symbol: string }
> = {
  baseline_recency: { color: "#6B7280", dash: "dashed", symbol: "rect" },
  logreg: { color: "#0072B2", dash: "solid", symbol: "circle" },
  random_forest: { color: "#D55E00", dash: "dotted", symbol: "triangle" },
};
const style = (n: string) =>
  MODEL_STYLE[n] ?? { color: "#4338ca", dash: "solid" as const, symbol: "circle" };

function diagLine(c: ChartColors) {
  return {
    name: "Random guessing",
    type: "line",
    data: [
      [0, 0],
      [1, 1],
    ],
    showSymbol: false,
    lineStyle: { color: c.muted, type: "dotted", width: 1.5 },
    itemStyle: { color: c.muted },
  };
}

function curveOption(
  models: ModelResult[],
  c: ChartColors,
  xName: string,
  yName: string,
  key: "roc" | "pr" | "gain",
  withDiag: boolean,
) {
  const ax = axisStyle(c);
  const series = models.map((m) => {
    const s = style(m.name);
    return {
      name: m.label,
      type: "line",
      data: m.curves[key],
      showSymbol: false,
      symbol: s.symbol,
      lineStyle: { color: s.color, type: s.dash, width: 2.5 },
      itemStyle: { color: s.color },
    };
  });
  return {
    grid: { left: 56, right: 16, top: 44, bottom: 52 },
    legend: { top: 0, textStyle: { color: c.text } },
    tooltip: { trigger: "axis" },
    xAxis: {
      type: "value",
      min: 0,
      max: 1,
      name: xName,
      nameLocation: "middle",
      nameGap: 30,
      ...ax,
    },
    yAxis: { type: "value", min: 0, max: 1, name: yName, ...ax },
    series: [...series, ...(withDiag ? [diagLine(c)] : [])],
  };
}

export function Predictions({ result }: { result: AnalysisResult }) {
  const c = useChartColors();
  const ax = axisStyle(c);
  const { models, protocol } = result;
  const [period, setPeriod] = useState<"validation" | "test">("test");

  const selected = models.find((m) => m.name === result.selectedModel) ?? null;
  const baseline = models.find((m) => m.name === "baseline_recency") ?? null;
  const [thrModelName, setThrModelName] = useState<string>(
    result.selectedModel ?? models[0]?.name ?? "",
  );
  const thrModel = models.find((m) => m.name === thrModelName) ?? selected ?? models[0] ?? null;
  const [threshold, setThreshold] = useState(0.5);

  const stats = useMemo(
    () => (thrModel ? statsAtThreshold(thrModel.testScores, threshold) : null),
    [thrModel, threshold],
  );

  const rocOpt = useMemo(
    () =>
      curveOption(
        models,
        c,
        "False alarms (1 − specificity)",
        "Repeat buyers found (recall)",
        "roc",
        true,
      ),
    [models, c],
  );
  const prOpt = useMemo(
    () =>
      curveOption(
        models,
        c,
        "Repeat buyers found (recall)",
        "Share of flagged who really return (precision)",
        "pr",
        false,
      ),
    [models, c],
  );
  const gainOpt = useMemo(
    () =>
      curveOption(
        models,
        c,
        "Share of customers contacted (best scores first)",
        "Share of repeat buyers reached",
        "gain",
        true,
      ),
    [models, c],
  );
  const calOpt = useMemo(
    () => ({
      grid: { left: 56, right: 16, top: 44, bottom: 52 },
      legend: { top: 0, textStyle: { color: c.text } },
      tooltip: { trigger: "axis" },
      xAxis: {
        type: "value",
        min: 0,
        max: 1,
        name: "Predicted chance",
        nameLocation: "middle",
        nameGap: 30,
        ...ax,
      },
      yAxis: { type: "value", min: 0, max: 1, name: "Share who really bought", ...ax },
      series: [
        ...models.map((m) => {
          const s = style(m.name);
          return {
            name: m.label,
            type: "line",
            data: m.curves.calibration.map((p) => [p.predicted, p.observed]),
            symbol: s.symbol,
            symbolSize: 8,
            lineStyle: { color: s.color, type: s.dash, width: 2.5 },
            itemStyle: { color: s.color },
          };
        }),
        { ...diagLine(c), name: "Perfectly calibrated" },
      ],
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [models, c],
  );
  const impOpt = useMemo(() => {
    const imp = [...(selected?.importance ?? [])].sort((a, b) => b.importance - a.importance);
    return {
      grid: { left: 8, right: 56, top: 8, bottom: 8, containLabel: true },
      xAxis: { type: "value", ...ax },
      yAxis: {
        type: "category",
        inverse: true,
        data: imp.map((i) => featureLabel(i.feature)),
        ...ax,
        axisLabel: { color: c.text },
      },
      tooltip: { trigger: "item" },
      series: [
        {
          type: "bar",
          data: imp.map((i) => i.importance),
          itemStyle: { color: "#7c3aed" },
          label: {
            show: true,
            position: "right",
            color: c.text,
            formatter: (p: { value: number }) => fmtDec(p.value, 2),
          },
        },
      ],
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected, c]);

  const curveTable = (key: "roc" | "pr" | "gain") => {
    const first = models[0];
    const n = first ? first.curves[key].length : 0;
    const step = Math.max(1, Math.ceil(n / 12));
    return models.flatMap((m) =>
      m.curves[key]
        .filter((_, i) => i % step === 0)
        .map((pt) => [m.label, fmtDec(pt[0], 3), fmtDec(pt[1], 3)]),
    );
  };

  const metricRow = (m: ModelResult): ModelMetrics => m[period];
  const baseM = baseline ? metricRow(baseline) : null;

  if (protocol === null || result.predictionSkipped) {
    return (
      <div className="stack">
        <h2 className="section-title" style={{ marginTop: 0 }}>
          {COPY.predictions.title}
        </h2>
        <Alert tone="warning" title={COPY.predictions.skippedTitle}>
          <p>
            {result.predictionSkipped?.message ??
              "There was not enough history to test a prediction fairly."}
          </p>
          <p>Segments and data-quality results are still available.</p>
        </Alert>
        <Limitations result={result} />
      </div>
    );
  }

  const gainLow = result.flags.includes("model_gain_low");
  const selM = selected?.test ?? null;
  const baseTest = baseline?.test ?? null;
  const protocolEntries: [string, string][] = [
    ["Look-ahead window", `${String(protocol.horizonDays)} days`],
    ["Scoring date (latest data)", fmtDate(protocol.scoringDate)],
    ["Test cut-off", fmtDate(protocol.testCutoff)],
    ["Validation cut-off", fmtDate(protocol.validationCutoff)],
    [
      "Training cut-offs",
      `${String(protocol.trainCutoffs.length)} (${protocol.trainCutoffs.map(fmtDate).join(", ")})`,
    ],
    ["Customers scored today", fmtInt(protocol.eligibleAtScoring)],
    ["Training examples", fmtInt(protocol.trainRows)],
  ];

  return (
    <div className="stack">
      <h2 className="section-title" style={{ marginTop: 0 }}>
        {COPY.predictions.title}
      </h2>

      {gainLow ? (
        <Alert tone="warning" title={COPY.predictions.gainLowTitle}>
          {COPY.predictions.gainLowBody}
        </Alert>
      ) : null}

      <section className="card accent" aria-labelledby="sum-h">
        <h3 id="sum-h">{COPY.predictions.summaryTitle}</h3>
        {selM && baseTest && selected ? (
          selected.name === "baseline_recency" ? (
            <p style={{ fontSize: "1.1rem" }}>
              On customers it had never seen, the simple recency rule put{" "}
              <strong>{fmtPct(selM.captureTop20, 0)}</strong> of repeat buyers in the top 20% of
              scores. No machine-learning model beat it clearly, so this rule is used.
            </p>
          ) : (
            <p style={{ fontSize: "1.1rem" }}>
              On customers the model had never seen, the top 20% by score contained{" "}
              <strong>{fmtPct(selM.captureTop20, 0)}</strong> of the people who really bought again.
              The simple recency rule captured <strong>{fmtPct(baseTest.captureTop20, 0)}</strong>.
            </p>
          )
        ) : (
          <p>{COPY.predictions.noModels}</p>
        )}
        {selM ? (
          <p className="muted small" style={{ marginTop: 6 }}>
            Test period: {fmtInt(selM.nRows)} customers, {fmtPct(selM.baseRate, 0)} of them bought
            again within {protocol.horizonDays} days (the base rate). Picking customers at random
            would find 20% of them in the top 20%.
          </p>
        ) : null}
      </section>

      <section className="card" aria-labelledby="met-h">
        <div className="chart-head">
          <div>
            <h3 id="met-h">{COPY.predictions.metricsTitle}</h3>
            <p className="muted small">{COPY.predictions.metricsHelp}</p>
          </div>
          <fieldset style={{ border: 0, padding: 0, margin: 0 }}>
            <legend className="sr-only">Evaluation period</legend>
            <div className="radio-row" style={{ marginTop: 0 }}>
              {(["validation", "test"] as const).map((p) => (
                <label key={p}>
                  <input
                    type="radio"
                    name="period"
                    checked={period === p}
                    onChange={() => {
                      setPeriod(p);
                    }}
                  />
                  {p === "validation" ? COPY.predictions.validation : COPY.predictions.test}
                </label>
              ))}
            </div>
          </fieldset>
        </div>
        <DataTable
          caption={`Model comparison on the ${period} period`}
          hideCaption
          rows={models}
          rowKey={(m) => m.name}
          columns={[
            {
              key: "m",
              header: "Model",
              rowHeader: true,
              render: (m) => (
                <span>
                  <strong>{MODEL_LABELS[m.name] ?? m.label}</strong>{" "}
                  {m.name === result.selectedModel ? <Pill tone="ok">✓ Selected</Pill> : null}
                  {m.name === "baseline_recency" ? <Pill tone="muted">Baseline</Pill> : null}
                </span>
              ),
            },
            {
              key: "pr",
              header: "PR-AUC",
              numeric: true,
              render: (m) => {
                const v = metricRow(m).prAuc;
                const d = baseM && m.name !== "baseline_recency" ? v - baseM.prAuc : null;
                return (
                  <>
                    {fmtDec(v, 3)}
                    {d !== null ? (
                      <span className="muted small">
                        {" "}
                        ({d >= 0 ? "+" : "−"}
                        {fmtDec(Math.abs(d), 3)} vs baseline)
                      </span>
                    ) : null}
                  </>
                );
              },
            },
            {
              key: "roc",
              header: "ROC-AUC",
              numeric: true,
              render: (m) => fmtDec(metricRow(m).rocAuc, 3),
            },
            {
              key: "brier",
              header: "Brier score (lower is better)",
              numeric: true,
              render: (m) => fmtDec(metricRow(m).brier, 3),
            },
            {
              key: "ll",
              header: "Log loss",
              numeric: true,
              render: (m) => fmtDec(metricRow(m).logLoss, 3),
            },
            {
              key: "prec",
              header: "Precision",
              numeric: true,
              render: (m) => fmtPct(metricRow(m).precision, 0),
            },
            {
              key: "rec",
              header: "Recall",
              numeric: true,
              render: (m) => fmtPct(metricRow(m).recall, 0),
            },
            { key: "f1", header: "F1", numeric: true, render: (m) => fmtDec(metricRow(m).f1, 2) },
            {
              key: "cap",
              header: "Repeat buyers in top 20%",
              numeric: true,
              render: (m) => fmtPct(metricRow(m).captureTop20, 0),
            },
            {
              key: "lift",
              header: "Lift, top 10%",
              numeric: true,
              render: (m) => `${fmtDec(metricRow(m).liftTop10, 1)}×`,
            },
          ]}
        />
        <p className="muted small" style={{ marginTop: 8 }}>
          Base rate in this period: {baseM ? fmtPct(baseM.baseRate, 1) : "–"}. PR-AUC
          (precision–recall area) is the headline number because repeat buyers are a minority; a
          model that is no better than chance would score about the base rate.
        </p>
      </section>

      <div className="grid grid-2">
        <div className="card">
          <Chart
            title="ROC curve"
            subtitle="Further up and left is better."
            option={rocOpt}
            ariaLabel="ROC curves for each model on the test period"
            tableData={{
              columns: ["Model", "False alarms", "Repeat buyers found"],
              rows: curveTable("roc"),
            }}
          />
        </div>
        <div className="card">
          <Chart
            title="Precision–recall curve"
            subtitle="Higher is better; compare with the base rate."
            option={prOpt}
            ariaLabel="Precision-recall curves for each model on the test period"
            tableData={{ columns: ["Model", "Recall", "Precision"], rows: curveTable("pr") }}
          />
        </div>
        <div className="card">
          <Chart
            title="Are the percentages honest? (calibration)"
            subtitle="Points close to the dotted line mean “30%” really means about 30%."
            option={calOpt}
            ariaLabel="Calibration curves: predicted chance against observed share who bought again"
            tableData={{
              columns: ["Model", "Predicted", "Observed", "Customers"],
              rows: models.flatMap((m) =>
                m.curves.calibration.map((p) => [
                  m.label,
                  fmtPct(p.predicted, 0),
                  fmtPct(p.observed, 0),
                  fmtInt(p.n),
                ]),
              ),
            }}
          />
        </div>
        <div className="card">
          <Chart
            title="Gain: how many repeat buyers do I reach?"
            subtitle="Contact the best-scored customers first; a steeper line means less wasted effort."
            option={gainOpt}
            ariaLabel="Cumulative gain curves for each model"
            tableData={{
              columns: ["Model", "Share contacted", "Share of repeat buyers reached"],
              rows: curveTable("gain"),
            }}
          />
        </div>
        <div className="card">
          <Chart
            title={`What matters most (${selected ? (MODEL_LABELS[selected.name] ?? selected.label) : "model"})`}
            option={impOpt}
            height={260}
            ariaLabel="Bar chart of feature importance for the selected model"
            tableData={{
              columns: ["Signal", "Importance"],
              rows: (selected?.importance ?? []).map((i) => [
                featureLabel(i.feature),
                fmtDec(i.importance, 3),
              ]),
            }}
          />
        </div>

        <section className="card" aria-labelledby="thr-h">
          <h3 id="thr-h">{COPY.predictions.thresholdTitle}</h3>
          <p className="muted small">{COPY.predictions.thresholdHelp}</p>
          {models.length > 1 ? (
            <div style={{ margin: "8px 0" }}>
              <label className="field" htmlFor="thr-model">
                Model
              </label>
              <select
                id="thr-model"
                className="input"
                value={thrModel?.name ?? ""}
                onChange={(e) => {
                  setThrModelName(e.target.value);
                }}
              >
                {models.map((m) => (
                  <option key={m.name} value={m.name}>
                    {MODEL_LABELS[m.name] ?? m.label}
                  </option>
                ))}
              </select>
            </div>
          ) : null}
          <label className="field" htmlFor="thr">
            Count customers as “likely to buy again” when chance is at least{" "}
            <strong>{fmtPct(threshold, 0)}</strong>
          </label>
          <input
            id="thr"
            type="range"
            min={0.05}
            max={0.95}
            step={0.01}
            value={threshold}
            aria-valuetext={fmtPct(threshold, 0)}
            onChange={(e) => {
              setThreshold(Number(e.target.value));
            }}
          />
          {stats ? (
            <>
              <dl className="kv" aria-live="polite" style={{ margin: "8px 0 12px" }}>
                <dt>Precision (of those flagged, how many really return)</dt>
                <dd>{fmtPct(stats.precision, 1)}</dd>
                <dt>Recall (of those who return, how many flagged)</dt>
                <dd>{fmtPct(stats.recall, 1)}</dd>
                <dt>F1 (balance of the two)</dt>
                <dd>{fmtDec(stats.f1, 3)}</dd>
                <dt>Customers flagged</dt>
                <dd>
                  {fmtInt(stats.flagged)} of {fmtInt(thrModel?.testScores.length ?? 0)}
                </dd>
              </dl>
              <div className="cm-grid" role="table" aria-label="Confusion matrix">
                <div role="row" style={{ display: "contents" }}>
                  <div role="columnheader" />
                  <div role="columnheader" className="small muted">
                    Actually bought again
                  </div>
                  <div role="columnheader" className="small muted">
                    Did not
                  </div>
                </div>
                <div role="row" style={{ display: "contents" }}>
                  <div role="rowheader" className="small muted">
                    Flagged likely
                  </div>
                  <div role="cell" className="cm-cell cm-good">
                    {fmtInt(stats.tp)}
                    <small>Correct (true positive)</small>
                  </div>
                  <div role="cell" className="cm-cell cm-bad">
                    {fmtInt(stats.fp)}
                    <small>Wasted contact (false positive)</small>
                  </div>
                </div>
                <div role="row" style={{ display: "contents" }}>
                  <div role="rowheader" className="small muted">
                    Not flagged
                  </div>
                  <div role="cell" className="cm-cell cm-bad">
                    {fmtInt(stats.fn)}
                    <small>Missed (false negative)</small>
                  </div>
                  <div role="cell" className="cm-cell cm-good">
                    {fmtInt(stats.tn)}
                    <small>Correct (true negative)</small>
                  </div>
                </div>
              </div>
            </>
          ) : null}
        </section>
      </div>

      <section className="card" aria-labelledby="prot-h">
        <h3 id="prot-h">{COPY.predictions.protocolTitle}</h3>
        <dl className="kv" style={{ margin: "8px 0" }}>
          {protocolEntries.map(([k, v]) => (
            <div key={k} style={{ display: "contents" }}>
              <dt>{k}</dt>
              <dd>{v}</dd>
            </div>
          ))}
        </dl>
        <ul className="protocol-list">
          {COPY.predictions.protocolPoints.map((p) => (
            <li key={p}>{p}</li>
          ))}
        </ul>
        <p className="muted small" style={{ marginTop: 8 }}>
          Settings used:{" "}
          {selected
            ? Object.entries(selected.hyperparameters)
                .map(([k, v]) => `${k}=${String(v)}`)
                .join(", ") || "none"
            : "–"}
          . Random seed fixed at 42 in the engine, so the same file gives the same result.
        </p>
      </section>

      <Limitations result={result} />
    </div>
  );
}

function Limitations({ result }: { result: AnalysisResult }) {
  return (
    <section className="card" aria-labelledby="lim-h">
      <h3 id="lim-h">{COPY.predictions.limitsTitle}</h3>
      {result.dataset.synthetic ? (
        <div style={{ margin: "8px 0" }}>
          <Alert tone="warning">{COPY.predictions.syntheticLimit}</Alert>
        </div>
      ) : null}
      <ul style={{ paddingLeft: 18 }}>
        {COPY.predictions.limits.map((l) => (
          <li key={l} style={{ margin: "4px 0" }}>
            {l}
          </li>
        ))}
        {result.quality.profile.wholesaleCustomers > 0 ? (
          <li>
            This file has {fmtInt(result.quality.profile.wholesaleCustomers)} wholesale customers,
            and the top 10% of customers bring{" "}
            {fmtPct(result.quality.profile.revenueShareTop10pct, 0)} of revenue.
          </li>
        ) : null}
      </ul>
    </section>
  );
}
