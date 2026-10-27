import { useEffect, useMemo, useRef } from "react";
import type { AnalysisResult } from "../../engine";
import { COPY } from "../copy";
import { detectCurrency, fmtDate, fmtInt, makeMoney } from "../format";
import { MoneyContext } from "../moneyContext";
import { TAB_IDS, isTabId } from "../tabIds";
import type { TabId } from "../tabIds";
import { Alert, Pill } from "../ui/basics";
import { Tabs } from "../ui/Tabs";
import type { TabDef } from "../ui/Tabs";
import { Customers } from "../tabs/Customers";
import { ExportTab } from "../tabs/ExportTab";
import { Overview } from "../tabs/Overview";
import { Predictions } from "../tabs/Predictions";
import { Quality } from "../tabs/Quality";
import { Segments } from "../tabs/Segments";

const TAB_COLORS: Record<TabId, string> = {
  overview: "#4338ca",
  quality: "#0f766e",
  segments: "#b45309",
  customers: "#0369a1",
  predictions: "#be185d",
  export: "#15803d",
};

interface Props {
  result: AnalysisResult;
  tab: TabId;
  onTab: (t: TabId) => void;
  onStartOver: () => void;
  onSwitch?: (() => void) | undefined;
  switchLabel?: string | undefined;
}

export default function Dashboard({
  result,
  tab,
  onTab,
  onStartOver,
  onSwitch,
  switchLabel,
}: Props) {
  const money = useMemo(() => makeMoney(detectCurrency(result.quality)), [result]);
  const selected = result.models.find((m) => m.name === result.selectedModel);
  const tabs: TabDef[] = TAB_IDS.map((id) => ({
    id,
    label: COPY.results.tabs[id],
    color: TAB_COLORS[id],
  }));
  const heading = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    document.title = `${result.dataset.name} · CustomerIQ`;
    return () => {
      document.title = "CustomerIQ";
    };
  }, [result.dataset.name]);

  return (
    <MoneyContext.Provider value={money}>
      <div className="container">
        <h1 ref={heading} className="sr-only" tabIndex={-1}>
          Results for {result.dataset.name}
        </h1>
        <div className="context-bar" role="region" aria-label="About these numbers">
          <dl style={{ display: "contents" }}>
            <div className="item">
              <dt>{COPY.results.ctxDataset}</dt>
              <dd>
                {result.dataset.name}{" "}
                {result.dataset.synthetic ? (
                  <Pill tone="synthetic">{COPY.results.synthetic}</Pill>
                ) : null}
              </dd>
            </div>
            <div className="item">
              <dt>{COPY.results.ctxScoring}</dt>
              <dd>
                {result.protocol
                  ? fmtDate(result.protocol.scoringDate)
                  : fmtDate(result.quality.profile.dateMax)}
              </dd>
            </div>
            <div className="item">
              <dt>{COPY.results.ctxHorizon}</dt>
              <dd>{result.protocol ? `${String(result.protocol.horizonDays)} days` : "–"}</dd>
            </div>
            <div className="item">
              <dt>{COPY.results.ctxEligible}</dt>
              <dd>{fmtInt(result.protocol?.eligibleAtScoring ?? result.customers.length)}</dd>
            </div>
            <div className="item">
              <dt>{COPY.results.ctxModel}</dt>
              <dd>{selected ? selected.label : COPY.results.noModel}</dd>
            </div>
          </dl>
          <div className="context-actions">
            {onSwitch && switchLabel ? (
              <button type="button" className="btn btn-ghost btn-sm" onClick={onSwitch}>
                {switchLabel}
              </button>
            ) : null}
            <button type="button" className="btn btn-secondary btn-sm" onClick={onStartOver}>
              {COPY.results.startOver}
            </button>
          </div>
        </div>

        {result.dataset.synthetic ? (
          <div style={{ marginBottom: 16 }}>
            <Alert tone="warning" title="Synthetic data">
              {COPY.results.syntheticBanner}
            </Alert>
          </div>
        ) : null}

        <Tabs
          tabs={tabs}
          active={tab}
          onChange={(id) => {
            if (isTabId(id)) onTab(id);
          }}
          label={COPY.results.tabsLabel}
          idPrefix="results"
        >
          {tab === "overview" && <Overview result={result} onTab={onTab} />}
          {tab === "quality" && <Quality result={result} />}
          {tab === "segments" && <Segments result={result} />}
          {tab === "customers" && <Customers result={result} />}
          {tab === "predictions" && <Predictions result={result} />}
          {tab === "export" && <ExportTab result={result} />}
        </Tabs>
      </div>
    </MoneyContext.Provider>
  );
}
