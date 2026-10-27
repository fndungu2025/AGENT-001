import { useMemo, useState } from "react";
import type { AnalysisResult, RiskBand, SegmentKey } from "../../engine";
import { COPY } from "../copy";
import { fmtInt, fmtPct } from "../format";
import { filterCustomers, NO_FILTERS, sortCustomers } from "../lib/customers";
import { downloadCsv, qualityCsv, targetListCsv } from "../lib/csv";
import { BANDS, SEGMENTS, segmentAction, segmentName } from "../meta";
import { useMoney } from "../moneyContext";
import { Alert, BandPill, SegmentPill } from "../ui/basics";
import { DataTable } from "../ui/DataTable";

export function ExportTab({ result }: { result: AnalysisResult }) {
  const money = useMoney();
  const [segment, setSegment] = useState<SegmentKey | "all">("all");
  const [band, setBand] = useState<RiskBand | "all">("all");
  const [minP, setMinP] = useState(0);

  const list = useMemo(
    () =>
      sortCustomers(
        filterCustomers(result.customers, { ...NO_FILTERS, segment, band, minP }),
        "expectedValue",
        "desc",
      ),
    [result.customers, segment, band, minP],
  );
  const hasPredictions = result.protocol !== null;

  return (
    <div className="stack">
      <div>
        <h2 className="section-title" style={{ marginTop: 0 }}>
          {COPY.exportTab.title}
        </h2>
        <p className="muted">{COPY.exportTab.lead}</p>
      </div>

      <section className="card accent" aria-label="Choose who to include">
        <div className="filters">
          <div>
            <label className="field" htmlFor="x-seg">
              {COPY.exportTab.segment}
            </label>
            <select
              id="x-seg"
              className="input"
              value={segment}
              onChange={(e) => {
                setSegment(e.target.value as SegmentKey | "all");
              }}
            >
              <option value="all">{COPY.customers.all}</option>
              {SEGMENTS.map((m) => (
                <option key={m.key} value={m.key}>
                  {segmentName(m.key, result.segments)}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="field" htmlFor="x-band">
              {COPY.exportTab.band}
            </label>
            <select
              id="x-band"
              className="input"
              value={band}
              onChange={(e) => {
                setBand(e.target.value as RiskBand | "all");
              }}
            >
              <option value="all">{COPY.customers.all}</option>
              {BANDS.map((b) => (
                <option key={b.key} value={b.key}>
                  {b.label} ({b.range})
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="field" htmlFor="x-minp">
              {COPY.exportTab.minP}: {fmtPct(minP, 0)}
            </label>
            <input
              id="x-minp"
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={minP}
              onChange={(e) => {
                setMinP(Number(e.target.value));
              }}
            />
          </div>
        </div>
        {!hasPredictions ? <Alert tone="warning">{COPY.customers.noPrediction}</Alert> : null}
        <p role="status" aria-live="polite" style={{ fontSize: "1.15rem", margin: "10px 0" }}>
          <strong>{COPY.exportTab.preview(fmtInt(list.length))}</strong>
        </p>
        {segment !== "all" ? (
          <p className="small">
            <strong>{COPY.exportTab.nextStep}: </strong>
            {segmentAction(segment, result.segments)}
          </p>
        ) : null}
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginTop: 8 }}>
          <button
            type="button"
            className="btn btn-primary"
            disabled={list.length === 0}
            onClick={() => {
              downloadCsv("target-list.csv", targetListCsv(list, result.segments));
            }}
          >
            {COPY.exportTab.download}
          </button>
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => {
              downloadCsv("data-quality-report.csv", qualityCsv(result));
            }}
          >
            {COPY.quality.download}
          </button>
        </div>
        <p className="small muted" style={{ marginTop: 10 }}>
          {COPY.exportTab.safety}
        </p>
      </section>

      <section className="card" aria-labelledby="x-prev">
        <h3 id="x-prev">Preview (first 5, highest expected value first)</h3>
        <DataTable
          caption="Preview of the target list"
          hideCaption
          rows={list.slice(0, 5)}
          rowKey={(c) => c.id}
          empty={COPY.exportTab.empty}
          columns={[
            { key: "id", header: "Customer", rowHeader: true, render: (c) => c.id },
            {
              key: "seg",
              header: "Segment",
              render: (c) => (
                <SegmentPill segment={c.segment} label={segmentName(c.segment, result.segments)} />
              ),
            },
            {
              key: "p",
              header: "Chance to buy again",
              numeric: true,
              render: (c) => fmtPct(c.pRepeat, 0),
            },
            { key: "b", header: "Band", render: (c) => <BandPill band={c.riskBand} /> },
            {
              key: "ev",
              header: "Expected value",
              numeric: true,
              render: (c) => money.full(c.expectedValue),
            },
            { key: "d", header: "Top reason", render: (c) => c.drivers[0]?.text ?? "" },
          ]}
        />
      </section>
    </div>
  );
}
