import { useDeferredValue, useMemo, useState } from "react";
import type { AnalysisResult, CustomerRow, RiskBand, SegmentKey } from "../../engine";
import { COPY, featureLabel } from "../copy";
import { fmtDate, fmtInt, fmtPct } from "../format";
import { BANDS, SEGMENTS, segmentName } from "../meta";
import { useMoney } from "../moneyContext";
import { NO_FILTERS, filterCustomers, sortCustomers } from "../lib/customers";
import type { CustomerFilters, SortKey } from "../lib/customers";
import { Alert, BandPill, Pill, SegmentPill } from "../ui/basics";
import { DataTable } from "../ui/DataTable";
import type { Column } from "../ui/DataTable";
import { Drawer } from "../ui/Drawer";

const PAGE = 50;

export function Customers({ result }: { result: AnalysisResult }) {
  const money = useMoney();
  const [filters, setFilters] = useState<CustomerFilters>(NO_FILTERS);
  const [sort, setSort] = useState<{ key: SortKey; dir: "asc" | "desc" }>({
    key: "pRepeat",
    dir: "desc",
  });
  const [page, setPage] = useState(0);
  const [open, setOpen] = useState<CustomerRow | null>(null);
  const horizon = result.protocol?.horizonDays ?? 60;
  const hasPredictions = result.protocol !== null;

  const deferredQuery = useDeferredValue(filters.query);
  const effective = useMemo(() => ({ ...filters, query: deferredQuery }), [filters, deferredQuery]);

  const countries = useMemo(
    () => [...new Set(result.customers.map((c) => c.country))].filter(Boolean).sort(),
    [result.customers],
  );
  const filtered = useMemo(
    () => filterCustomers(result.customers, effective),
    [result.customers, effective],
  );
  const sorted = useMemo(() => sortCustomers(filtered, sort.key, sort.dir), [filtered, sort]);
  const pages = Math.max(1, Math.ceil(sorted.length / PAGE));
  const safePage = Math.min(page, pages - 1);
  const rows = sorted.slice(safePage * PAGE, safePage * PAGE + PAGE);

  const update = (patch: Partial<CustomerFilters>) => {
    setFilters((f) => ({ ...f, ...patch }));
    setPage(0);
  };
  const onSort = (key: string) => {
    const k = key as SortKey;
    setSort((s) =>
      s.key === k
        ? { key: k, dir: s.dir === "asc" ? "desc" : "asc" }
        : { key: k, dir: k === "id" || k === "country" || k === "segment" ? "asc" : "desc" },
    );
    setPage(0);
  };

  const columns: Column<CustomerRow>[] = [
    {
      key: "id",
      header: "Customer",
      sortable: true,
      rowHeader: true,
      render: (c) => (
        <button
          type="button"
          className="link-btn"
          aria-label={`Open details for customer ${c.id}`}
          onClick={() => {
            setOpen(c);
          }}
        >
          {c.id}
        </button>
      ),
    },
    {
      key: "pRepeat",
      header: `Chance to buy again (${String(horizon)} days)`,
      sortable: true,
      numeric: true,
      render: (c) =>
        hasPredictions ? (
          <span
            style={{
              display: "inline-flex",
              gap: 8,
              alignItems: "center",
              justifyContent: "flex-end",
            }}
          >
            <strong>{fmtPct(c.pRepeat, 0)}</strong>
            <BandPill band={c.riskBand} />
          </span>
        ) : (
          "–"
        ),
    },
    {
      key: "segment",
      header: "Segment",
      sortable: true,
      render: (c) => (
        <SegmentPill segment={c.segment} label={segmentName(c.segment, result.segments)} />
      ),
    },
    { key: "rfm", header: "RFM", sortable: true, render: (c) => c.rfm.score },
    { key: "lastOrder", header: "Last order", sortable: true, render: (c) => fmtDate(c.lastOrder) },
    {
      key: "frequency",
      header: "Orders",
      sortable: true,
      numeric: true,
      render: (c) => fmtInt(c.frequency),
    },
    {
      key: "monetary",
      header: "Total spend",
      sortable: true,
      numeric: true,
      render: (c) => money.full(c.monetary),
    },
    { key: "country", header: "Country", sortable: true, render: (c) => c.country },
  ];

  return (
    <div className="stack">
      <div>
        <h2 className="section-title" style={{ marginTop: 0 }}>
          {COPY.customers.title}
        </h2>
        {!hasPredictions ? <Alert tone="warning">{COPY.customers.noPrediction}</Alert> : null}
      </div>

      <section className="card" aria-label="Filters">
        <div className="filters">
          <div>
            <label className="field" htmlFor="c-search">
              {COPY.customers.search}
            </label>
            <input
              id="c-search"
              className="input"
              type="search"
              value={filters.query}
              onChange={(e) => {
                update({ query: e.target.value });
              }}
            />
          </div>
          <div>
            <label className="field" htmlFor="c-seg">
              {COPY.customers.segment}
            </label>
            <select
              id="c-seg"
              className="input"
              value={filters.segment}
              onChange={(e) => {
                update({ segment: e.target.value as SegmentKey | "all" });
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
            <label className="field" htmlFor="c-band">
              {COPY.customers.band}
            </label>
            <select
              id="c-band"
              className="input"
              value={filters.band}
              onChange={(e) => {
                update({ band: e.target.value as RiskBand | "all" });
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
            <label className="field" htmlFor="c-country">
              {COPY.customers.country}
            </label>
            <select
              id="c-country"
              className="input"
              value={filters.country}
              onChange={(e) => {
                update({ country: e.target.value });
              }}
            >
              <option value="all">{COPY.customers.all}</option>
              {countries.map((k) => (
                <option key={k} value={k}>
                  {k}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="field" htmlFor="c-wh">
              {COPY.customers.wholesale}
            </label>
            <select
              id="c-wh"
              className="input"
              value={filters.wholesale}
              onChange={(e) => {
                update({ wholesale: e.target.value as CustomerFilters["wholesale"] });
              }}
            >
              <option value="any">{COPY.customers.any}</option>
              <option value="yes">{COPY.customers.yes}</option>
              <option value="no">{COPY.customers.no}</option>
            </select>
          </div>
          <div>
            <label className="field" htmlFor="c-minp">
              {COPY.customers.minP}: {fmtPct(filters.minP, 0)}
            </label>
            <input
              id="c-minp"
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={filters.minP}
              onChange={(e) => {
                update({ minP: Number(e.target.value) });
              }}
            />
          </div>
        </div>
        <p role="status" aria-live="polite">
          <strong>{COPY.customers.results(fmtInt(sorted.length))}</strong>{" "}
          <button
            type="button"
            className="link-btn"
            onClick={() => {
              setFilters(NO_FILTERS);
              setPage(0);
            }}
          >
            Clear filters
          </button>
        </p>
      </section>

      <DataTable
        caption={COPY.customers.caption}
        hideCaption
        columns={columns}
        rows={rows}
        rowKey={(c) => c.id}
        sort={sort}
        onSort={onSort}
        empty="No customers match these filters."
      />

      <nav className="pager" aria-label="Pages">
        <span className="muted">
          Page {safePage + 1} of {pages} · showing {fmtInt(rows.length)} of {fmtInt(sorted.length)}
        </span>
        <span style={{ display: "flex", gap: 8 }}>
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            disabled={safePage === 0}
            onClick={() => {
              setPage(safePage - 1);
            }}
          >
            Previous
          </button>
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            disabled={safePage >= pages - 1}
            onClick={() => {
              setPage(safePage + 1);
            }}
          >
            Next
          </button>
        </span>
      </nav>

      {open ? (
        <Drawer
          title={`${COPY.customers.detailsTitle}: ${open.id}`}
          onClose={() => {
            setOpen(null);
          }}
        >
          <div className="stack">
            <p style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <SegmentPill
                segment={open.segment}
                label={segmentName(open.segment, result.segments)}
              />
              {hasPredictions ? <BandPill band={open.riskBand} /> : null}
              {open.isWholesale ? <Pill tone="info">Wholesale</Pill> : null}
            </p>
            {hasPredictions ? (
              <div className="card">
                <p className="muted">Chance of buying again ({horizon} days)</p>
                <p className="big-stat">{fmtPct(open.pRepeat, 0)}</p>
                <p className="muted small">
                  Expected value: {money.full(open.expectedValue)} (chance × average order)
                </p>
              </div>
            ) : null}
            <dl className="kv">
              <dt>Days since last order</dt>
              <dd>{fmtInt(open.recencyDays)}</dd>
              <dt>Last order</dt>
              <dd>{fmtDate(open.lastOrder)}</dd>
              <dt>First order</dt>
              <dd>{fmtDate(open.firstOrder)}</dd>
              <dt>Orders</dt>
              <dd>{fmtInt(open.frequency)}</dd>
              <dt>Total spend</dt>
              <dd>{money.full(open.monetary)}</dd>
              <dt>Average order</dt>
              <dd>{money.full(open.avgOrderValue)}</dd>
              <dt>RFM scores (R / F / M)</dt>
              <dd>
                {open.rfm.r} / {open.rfm.f} / {open.rfm.m}
              </dd>
              <dt>Country</dt>
              <dd>{open.country}</dd>
            </dl>
            <section aria-labelledby="drv-h">
              <h3 id="drv-h">{COPY.customers.drivers}</h3>
              {open.drivers.length === 0 ? (
                <p className="muted">{COPY.customers.noDrivers}</p>
              ) : (
                <ol style={{ paddingLeft: 20 }}>
                  {open.drivers.slice(0, 3).map((d) => (
                    <li key={d.feature} style={{ margin: "8px 0" }}>
                      <Pill tone={d.direction === "up" ? "ok" : "warn"}>
                        <span aria-hidden="true">{d.direction === "up" ? "↑" : "↓"}</span>
                        {d.direction === "up" ? "Raises chance" : "Lowers chance"}
                      </Pill>{" "}
                      <span className="muted small">{featureLabel(d.feature)}</span>
                      <br />
                      {d.text}
                    </li>
                  ))}
                </ol>
              )}
            </section>
          </div>
        </Drawer>
      ) : null}
    </div>
  );
}
