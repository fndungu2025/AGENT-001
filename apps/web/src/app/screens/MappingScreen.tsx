import { useMemo, useState } from "react";
import type {
  AnalysisOptions,
  CanonicalField,
  ColumnMapping,
  MappingSuggestion,
  RawTable,
} from "../../engine";
import { REQUIRED_FIELDS } from "../../engine/types";
import { COPY, FIELD_LABELS, FIELD_ORDER } from "../copy";
import { fmtInt } from "../format";
import { Alert, Pill } from "../ui/basics";
import type { PillTone } from "../ui/basics";

interface Props {
  table: RawTable;
  suggestions: MappingSuggestion[];
  defaults: AnalysisOptions;
  onRun: (mapping: ColumnMapping, options: AnalysisOptions) => void;
  onBack: () => void;
}

export function mappingFromSuggestions(s: MappingSuggestion[]): ColumnMapping {
  const m: ColumnMapping = {};
  for (const x of s) if (x.column !== null && x.confidence > 0) m[x.field] = x.column;
  return m;
}

export function MappingScreen({ table, suggestions, defaults, onRun, onBack }: Props) {
  const initial = useMemo(() => mappingFromSuggestions(suggestions), [suggestions]);
  const [mapping, setMapping] = useState<ColumnMapping>(initial);
  const [options, setOptions] = useState<AnalysisOptions>(defaults);
  const touched = useRef_(new Set<CanonicalField>());

  const missing = REQUIRED_FIELDS.filter((f) => !mapping[f]);
  const canRun = missing.length === 0;

  const setField = (f: CanonicalField, col: string) => {
    touched.add(f);
    setMapping((m) => {
      const next = { ...m };
      if (col === "") delete next[f];
      else next[f] = col;
      return next;
    });
  };

  const conf = (f: CanonicalField): { tone: PillTone; text: string } => {
    if (touched.has(f)) return { tone: "info", text: "Chosen by you" };
    const c = suggestions.find((s) => s.field === f)?.confidence ?? 0;
    if (!mapping[f]) return { tone: "muted", text: "Not matched" };
    return { tone: c >= 0.8 ? "ok" : c >= 0.5 ? "warn" : "bad", text: COPY.mapping.confidence(c) };
  };

  const preview = table.rows.slice(0, 10);

  return (
    <div className="container">
      <div className="page-title">
        <h1>{COPY.mapping.title}</h1>
        <p className="muted" style={{ marginTop: 6 }}>
          {COPY.mapping.lead}
        </p>
        <p style={{ marginTop: 8, display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          <strong>{table.name}</strong>
          {table.synthetic ? <Pill tone="synthetic">SYNTHETIC</Pill> : null}
          <span className="muted">{COPY.mapping.rows(fmtInt(table.rows.length))}</span>
        </p>
      </div>

      <div className="grid grid-2" style={{ alignItems: "start" }}>
        <section className="card accent" aria-labelledby="map-h">
          <h2 id="map-h">Columns</h2>
          <div className="stack">
            {FIELD_ORDER.map((f) => {
              const meta = FIELD_LABELS[f];
              const c = conf(f);
              const id = `map-${f}`;
              return (
                <div key={f}>
                  <label className="field" htmlFor={id}>
                    {meta.label}{" "}
                    <Pill tone={meta.required ? "vio" : "muted"}>
                      {meta.required ? COPY.mapping.required : COPY.mapping.optional}
                    </Pill>{" "}
                    <Pill tone={c.tone}>{c.text}</Pill>
                  </label>
                  <select
                    id={id}
                    className="input"
                    value={mapping[f] ?? ""}
                    aria-required={meta.required}
                    aria-describedby={`${id}-help`}
                    onChange={(e) => {
                      setField(f, e.target.value);
                    }}
                  >
                    <option value="">{COPY.mapping.notMapped}</option>
                    {table.columns.map((col) => (
                      <option key={col} value={col}>
                        {col}
                      </option>
                    ))}
                  </select>
                  <p id={`${id}-help`} className="small muted">
                    {meta.help}
                  </p>
                </div>
              );
            })}
          </div>
        </section>

        <section className="card accent" aria-labelledby="opt-h" style={{ ["--accent" as string]: "var(--brand-3)" }}>
          <h2 id="opt-h">{COPY.mapping.options}</h2>
          <div className="stack">
            <fieldset style={{ border: 0, padding: 0, margin: 0 }}>
              <legend className="field">{COPY.mapping.horizon}</legend>
              <div className="radio-row">
                {([30, 60, 90] as const).map((h) => (
                  <label key={h}>
                    <input
                      type="radio"
                      name="horizon"
                      checked={options.horizonDays === h}
                      onChange={() => {
                        setOptions((o) => ({ ...o, horizonDays: h }));
                      }}
                    />
                    {h} days
                  </label>
                ))}
              </div>
              <p className="small muted">{COPY.mapping.horizonHelp}</p>
            </fieldset>
            <fieldset style={{ border: 0, padding: 0, margin: 0 }}>
              <legend className="field">{COPY.mapping.cancellations}</legend>
              <div className="radio-row">
                <label>
                  <input
                    type="radio"
                    name="cancel"
                    checked={options.cancellationMode === "net"}
                    onChange={() => {
                      setOptions((o) => ({ ...o, cancellationMode: "net" }));
                    }}
                  />
                  {COPY.mapping.cancelNet}
                </label>
                <label>
                  <input
                    type="radio"
                    name="cancel"
                    checked={options.cancellationMode === "exclude"}
                    onChange={() => {
                      setOptions((o) => ({ ...o, cancellationMode: "exclude" }));
                    }}
                  />
                  {COPY.mapping.cancelExclude}
                </label>
              </div>
            </fieldset>
            <div>
              <label className="field" htmlFor="date-order">
                {COPY.mapping.dateOrder}
              </label>
              <select
                id="date-order"
                className="input"
                value={options.dateOrder}
                onChange={(e) => {
                  const v = e.target.value;
                  setOptions((o) => ({ ...o, dateOrder: v === "DMY" || v === "MDY" ? v : "auto" }));
                }}
              >
                <option value="auto">{COPY.mapping.dateAuto}</option>
                <option value="DMY">{COPY.mapping.dateDmy}</option>
                <option value="MDY">{COPY.mapping.dateMdy}</option>
              </select>
            </div>
            <div>
              <label className="check-row">
                <input
                  type="checkbox"
                  checked={options.excludeWholesale === true}
                  onChange={(e) => {
                    setOptions((o) => ({ ...o, excludeWholesale: e.target.checked }));
                  }}
                />
                {COPY.mapping.wholesale}
              </label>
              <p className="small muted">{COPY.mapping.wholesaleHelp}</p>
            </div>
          </div>
        </section>
      </div>

      <section className="card" style={{ marginTop: 16 }} aria-labelledby="prev-h">
        <h2 id="prev-h">{COPY.mapping.preview}</h2>
        <div className="table-wrap" tabIndex={0} role="region" aria-label={COPY.mapping.preview}>
          <table className="data">
            <thead>
              <tr>
                {table.columns.map((c) => (
                  <th key={c} scope="col">
                    {c}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {preview.map((r, i) => (
                <tr key={i}>
                  {table.columns.map((c, j) => (
                    <td key={c}>{r[j] ?? ""}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <div style={{ marginTop: 16 }} aria-live="polite">
        {canRun ? (
          <Alert tone="success">{COPY.mapping.allSet}</Alert>
        ) : (
          <Alert tone="warning">
            {COPY.mapping.missing(missing.map((f) => FIELD_LABELS[f].label))}
          </Alert>
        )}
      </div>
      <div style={{ marginTop: 16, display: "flex", gap: 12, flexWrap: "wrap" }}>
        <button
          type="button"
          className="btn btn-primary"
          disabled={!canRun}
          onClick={() => {
            onRun(mapping, options);
          }}
        >
          {COPY.mapping.run}
        </button>
        <button type="button" className="btn btn-secondary" onClick={onBack}>
          {COPY.mapping.back}
        </button>
      </div>
    </div>
  );
}
