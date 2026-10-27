import type { AnalysisResult } from "../../engine";
import { COPY, RULE_MEANING } from "../copy";
import { fmtDate, fmtInt, fmtPct, fmtPoints } from "../format";
import { useMoney } from "../moneyContext";
import { Alert, KpiTile, Pill } from "../ui/basics";
import { DataTable } from "../ui/DataTable";
import { downloadCsv, qualityCsv } from "../lib/csv";

export function Quality({ result }: { result: AnalysisResult }) {
  const money = useMoney();
  const q = result.quality;
  const rec = q.reconciliation;
  const p = q.profile;
  const droppedPct = q.rowsRead > 0 ? 1 - q.rowsKept / q.rowsRead : 0;

  return (
    <div className="stack">
      <div>
        <h2 className="section-title" style={{ marginTop: 0 }}>
          {COPY.quality.title}
        </h2>
        <p className="muted">{COPY.quality.lead}</p>
      </div>

      <div className="grid grid-kpi">
        <KpiTile label="Rows read" value={fmtInt(q.rowsRead)} color="#0369a1" />
        <KpiTile
          label="Rows kept"
          value={fmtInt(q.rowsKept)}
          hint={`${fmtPct(droppedPct, 1)} set aside`}
          color="#15803d"
        />
        <KpiTile label="Customers" value={fmtInt(p.customers)} color="#6d28d9" />
        <KpiTile label="Orders (invoices)" value={fmtInt(p.invoices)} color="#b45309" />
      </div>

      <section className="card accent" aria-labelledby="warn-h">
        <h3 id="warn-h">{COPY.quality.warnings}</h3>
        {q.warnings.length === 0 ? (
          <Alert tone="success">{COPY.quality.noWarnings}</Alert>
        ) : (
          <div className="stack">
            {q.warnings.map((w) => (
              <Alert
                key={w.code}
                tone={
                  w.severity === "error" ? "error" : w.severity === "warning" ? "warning" : "info"
                }
                title={
                  w.severity === "error" ? "Problem" : w.severity === "warning" ? "Warning" : "Note"
                }
              >
                {w.message}
              </Alert>
            ))}
          </div>
        )}
      </section>

      <section className="card" aria-labelledby="rules-h">
        <h3 id="rules-h">{COPY.quality.rules}</h3>
        <DataTable
          caption="Rows and revenue affected by each cleaning rule"
          hideCaption
          rows={q.rules}
          rowKey={(r) => r.id}
          columns={[
            { key: "id", header: "Rule", render: (r) => <strong>{r.id}</strong>, rowHeader: true },
            {
              key: "d",
              header: "What it does",
              render: (r) => (
                <>
                  {r.description}
                  <br />
                  <span className="muted small">
                    {COPY.quality.meaning}: {RULE_MEANING[r.id] ?? ""}
                  </span>
                </>
              ),
            },
            { key: "rows", header: "Rows affected", numeric: true, render: (r) => fmtInt(r.rows) },
            {
              key: "rev",
              header: "Revenue affected",
              numeric: true,
              render: (r) => money.full(r.revenue),
            },
          ]}
        />
      </section>

      <div className="grid grid-2">
        <section className="card" aria-labelledby="rec-h">
          <h3 id="rec-h">{COPY.quality.reconciliation}</h3>
          <dl className="kv" style={{ marginTop: 8 }}>
            <dt>Gross revenue</dt>
            <dd>{money.full(rec.gross)}</dd>
            <dt>Cancellations and returns</dt>
            <dd>{money.full(rec.cancellations)}</dd>
            <dt>Set aside (excluded)</dt>
            <dd>{money.full(-Math.abs(rec.excluded))}</dd>
            <dt>Net revenue</dt>
            <dd>{money.full(rec.net)}</dd>
          </dl>
          <div style={{ marginTop: 12 }}>
            {rec.balances ? (
              <Alert tone="success" title="Balances ✓">
                {COPY.quality.balances}
              </Alert>
            ) : (
              <Alert tone="error" title="Does not balance ✗">
                {COPY.quality.notBalances}
              </Alert>
            )}
          </div>
        </section>

        <section className="card" aria-labelledby="prof-h">
          <h3 id="prof-h">{COPY.quality.profile}</h3>
          <dl className="kv" style={{ marginTop: 8 }}>
            <dt>Date range</dt>
            <dd>
              {fmtDate(p.dateMin)} to {fmtDate(p.dateMax)}
            </dd>
            <dt>Products</dt>
            <dd>{fmtInt(p.products)}</dd>
            <dt>Rows without a customer ID</dt>
            <dd>{fmtPoints(p.missingCustomerPct, 1)}</dd>
            <dt>Wholesale customers</dt>
            <dd>{fmtInt(p.wholesaleCustomers)}</dd>
            <dt>Top 1% of customers’ share of revenue</dt>
            <dd>{fmtPct(p.revenueShareTop1pct, 0)}</dd>
            <dt>Top 10% of customers’ share of revenue</dt>
            <dd>{fmtPct(p.revenueShareTop10pct, 0)}</dd>
          </dl>
          <p className="small muted" style={{ marginTop: 10 }}>
            Top countries by rows:{" "}
            {p.topCountries.map((c) => (
              <Pill key={c.country} tone="muted">
                {c.country} {fmtPoints(c.rowsPct, 0)}
              </Pill>
            ))}
          </p>
        </section>
      </div>

      <section className="card" aria-labelledby="mean-h">
        <h3 id="mean-h">{COPY.quality.meaning}</h3>
        <ul style={{ paddingLeft: 18 }}>
          <li>
            {fmtPct(droppedPct, 1)} of rows were set aside; the rules above explain why, and the
            totals still reconcile.
          </li>
          <li>
            Customer-level results use only rows with a customer ID (
            {fmtPoints(100 - p.missingCustomerPct, 0)} of rows).
          </li>
          <li>
            The top 10% of customers bring {fmtPct(p.revenueShareTop10pct, 0)} of revenue, so a few
            customers move the totals a lot.
          </li>
        </ul>
        <div style={{ marginTop: 12 }}>
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
      </section>
    </div>
  );
}
