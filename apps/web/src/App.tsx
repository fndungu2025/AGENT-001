import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  AnalysisOptions,
  AnalysisResult,
  ColumnMapping,
  MappingSuggestion,
  RawTable,
} from "./engine";
import { REQUIRED_FIELDS } from "./engine/types";
import { COPY } from "./app/copy";
import { loadEngine } from "./app/engineApi";
import { HowItWorks } from "./app/screens/HowItWorks";
import { mappingFromSuggestions } from "./app/lib/mapping";
import { MappingScreen } from "./app/screens/MappingScreen";
import { RunningScreen } from "./app/screens/RunningScreen";
import { StartScreen } from "./app/screens/StartScreen";
import { isTabId } from "./app/tabIds";
import type { TabId } from "./app/tabIds";
import { Footer, Header, Page, SkipLink } from "./app/ui/Layout";
import { useHash } from "./app/useHash";

const Dashboard = lazy(() => import("./app/screens/Dashboard"));

type Phase =
  | { name: "start" }
  | {
      name: "mapping";
      table: RawTable;
      suggestions: MappingSuggestion[];
      defaults: AnalysisOptions;
    }
  | {
      name: "running";
      table: RawTable;
      mapping: ColumnMapping;
      options: AnalysisOptions;
      defaults: AnalysisOptions;
      suggestions: MappingSuggestion[];
    }
  | { name: "results"; result: AnalysisResult };

type Kind = "sample" | "upload";

export function App() {
  const [hash, setHash] = useHash();
  const [phase, setPhase] = useState<Phase>({ name: "start" });
  const [cache, setCache] = useState<Partial<Record<Kind, AnalysisResult>>>({});
  const [note, setNote] = useState<string | undefined>();
  const resultsKind = useRef<Kind>("upload");

  // dev-only: ?fixture=1 loads the UI fixture (never active in production builds)
  useEffect(() => {
    if (import.meta.env.DEV && new URLSearchParams(window.location.search).get("fixture") === "1") {
      void import("./app/fixtures/analysisResult").then((m) => {
        resultsKind.current = "sample";
        setPhase({ name: "results", result: m.FIXTURE_RESULT });
      });
    }
  }, []);

  const view: "how" | "analytics" = hash === "how" ? "how" : "analytics";
  const tab: TabId = isTabId(hash) ? hash : "overview";
  const result = phase.name === "results" ? phase.result : null;

  const onLoaded = useCallback(async (table: RawTable) => {
    setNote(undefined);
    try {
      const engine = await loadEngine();
      const suggestions = engine.suggestMapping(table.columns);
      const defaults = engine.DEFAULT_OPTIONS;
      const mapping = mappingFromSuggestions(suggestions);
      resultsKind.current = table.synthetic === true ? "sample" : "upload";
      const complete = REQUIRED_FIELDS.every((f) => mapping[f]);
      if (table.synthetic === true && complete) {
        setPhase({ name: "running", table, mapping, options: defaults, defaults, suggestions });
      } else {
        setPhase({ name: "mapping", table, suggestions, defaults });
      }
    } catch {
      setNote("The analysis engine could not be loaded. Please refresh the page.");
    }
  }, []);

  const startOver = useCallback(() => {
    setCache({});
    setPhase({ name: "start" });
    setHash("start");
  }, [setHash]);

  const done = useCallback(
    (r: AnalysisResult) => {
      setCache((c) => ({ ...c, [resultsKind.current]: r }));
      setPhase({ name: "results", result: r });
      setHash("overview");
    },
    [setHash],
  );

  const other: Kind = result ? (result.dataset.synthetic ? "upload" : "sample") : "upload";
  const cachedOther = cache[other];
  const switchTo = useMemo(() => {
    if (!result) return undefined;
    return () => {
      if (cachedOther) {
        resultsKind.current = other;
        setPhase({ name: "results", result: cachedOther });
        setHash("overview");
      } else {
        setPhase({ name: "start" });
        setHash("start");
        setNote(
          other === "sample"
            ? "Pick “Try the sample data” to compare with your own file."
            : "Upload your own file below. The sample results are kept while you do.",
        );
      }
    };
  }, [result, cachedOther, other, setHash]);

  const switchLabel = other === "sample" ? COPY.results.switchSample : COPY.results.switchUpload;

  // keep the active tab in the URL hash
  useEffect(() => {
    if (phase.name === "results" && !isTabId(hash) && hash !== "how") setHash("overview");
  }, [phase.name, hash, setHash]);

  const analyticsHref = phase.name === "results" ? `#${tab}` : "#start";

  return (
    <div className="app">
      <SkipLink />
      <Header view={view} analyticsHref={analyticsHref} />
      <Page>
        {view === "how" ? <HowItWorks /> : null}
        <div hidden={view === "how"}>
          {phase.name === "start" && <StartScreen onLoaded={(t) => void onLoaded(t)} note={note} />}
          {phase.name === "mapping" && (
            <MappingScreen
              table={phase.table}
              suggestions={phase.suggestions}
              defaults={phase.defaults}
              onRun={(mapping, options) => {
                setPhase({ ...phase, name: "running", mapping, options });
              }}
              onBack={() => {
                setPhase({ name: "start" });
              }}
            />
          )}
          {phase.name === "running" && (
            <RunningScreen
              table={phase.table}
              mapping={phase.mapping}
              options={phase.options}
              onDone={done}
              onBack={() => {
                setPhase({
                  name: "mapping",
                  table: phase.table,
                  suggestions: phase.suggestions,
                  defaults: phase.defaults,
                });
              }}
            />
          )}
          {phase.name === "results" && (
            <Suspense
              fallback={
                <p className="container page-title" role="status">
                  Loading your results…
                </p>
              }
            >
              <Dashboard
                result={phase.result}
                tab={tab}
                onTab={setHash}
                onStartOver={startOver}
                onSwitch={switchTo}
                switchLabel={switchLabel}
              />
            </Suspense>
          )}
        </div>
      </Page>
      <Footer showUci={result !== null && /online[\s_-]*retail/i.test(result.dataset.name)} />
    </div>
  );
}
