import { useCallback, useEffect, useRef, useState } from "react";
import type {
  AnalysisOptions,
  AnalysisResult,
  ColumnMapping,
  Progress,
  RawTable,
} from "../../engine";
import { COPY } from "../copy";
import { loadEngine } from "../engineApi";
import { Alert } from "../ui/basics";
import { Stepper } from "../ui/Stepper";

interface Props {
  table: RawTable;
  mapping: ColumnMapping;
  options: AnalysisOptions;
  onDone: (result: AnalysisResult) => void;
  onBack: () => void;
}

export function RunningScreen({ table, mapping, options, onDone, onBack }: Props) {
  const [progress, setProgress] = useState<Progress | null>(null);
  const [announce, setAnnounce] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const cancelRef = useRef<(() => void) | null>(null);
  const lastStage = useRef<string>("");

  useEffect(() => {
    let active = true;
    lastStage.current = "";
    loadEngine()
      .then((engine) => {
        if (!active) return;
        const job = engine.analyzeInWorker(table, mapping, options, (p) => {
          if (!active) return;
          setProgress(p);
          if (p.stage !== lastStage.current) {
            lastStage.current = p.stage;
            setAnnounce(p.message);
          }
        });
        cancelRef.current = job.cancel;
        return job.promise.then((r) => {
          if (active) onDone(r);
        });
      })
      .catch((e: unknown) => {
        if (!active) return;
        setError(e instanceof Error && e.message ? e.message : "Unknown error");
      });
    return () => {
      active = false;
      cancelRef.current?.();
      cancelRef.current = null;
    };
    // attempt re-runs the analysis; table/mapping/options are fixed for this screen
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attempt]);

  const cancel = useCallback(() => {
    cancelRef.current?.();
    onBack();
  }, [onBack]);

  const pct = Math.max(0, Math.min(100, Math.round(progress?.pct ?? 0)));

  return (
    <div className="container" style={{ maxWidth: 760 }}>
      <div className="page-title">
        <h1>{COPY.running.title}</h1>
        <p className="muted" style={{ marginTop: 6 }}>
          {COPY.running.lead}
        </p>
      </div>
      {error ? (
        <div className="stack">
          <Alert tone="error" title={COPY.running.errorTitle}>
            <p>{error}</p>
            <p>{COPY.running.errorHelp}</p>
          </Alert>
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => {
                setError(null);
                setProgress(null);
                setAttempt((a) => a + 1);
              }}
            >
              {COPY.running.retry}
            </button>
            <button type="button" className="btn btn-secondary" onClick={onBack}>
              {COPY.running.backToMapping}
            </button>
          </div>
        </div>
      ) : (
        <div className="card stack">
          <div
            className="progress-track"
            role="progressbar"
            aria-label="Analysis progress"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={pct}
          >
            <div className="progress-fill" style={{ width: `${String(pct)}%` }} />
          </div>
          <p>
            <strong>{pct}%</strong>{" "}
            <span className="muted">{progress?.message ?? "Starting…"}</span>
          </p>
          <Stepper steps={COPY.running.steps} current={progress?.stage ?? null} />
          <div role="status" aria-live="polite" className="sr-only">
            {announce}
          </div>
          <div>
            <button type="button" className="btn btn-secondary" onClick={cancel}>
              {COPY.running.cancel}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
