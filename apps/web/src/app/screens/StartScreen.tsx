import { useRef, useState } from "react";
import type { DragEvent } from "react";
import type { RawTable } from "../../engine";
import { COPY, UCI_URL } from "../copy";
import { loadEngine } from "../engineApi";
import { Alert, Pill } from "../ui/basics";

const ACCEPT = ".csv,.tsv,.txt,.xlsx";
const OK_EXT = /\.(csv|tsv|txt|xlsx)$/i;
const MAX_BYTES = 200 * 1024 * 1024;

interface Props {
  onLoaded: (table: RawTable) => void;
  note?: string | undefined;
}

export function StartScreen({ onLoaded, note }: Props) {
  const [busy, setBusy] = useState<null | "file" | "sample">(null);
  const [error, setError] = useState<string | null>(null);
  const [drag, setDrag] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  async function handleFile(file: File) {
    setError(null);
    if (!OK_EXT.test(file.name)) {
      setError(COPY.start.badType);
      return;
    }
    if (file.size > MAX_BYTES) {
      setError("That file is larger than 200 MB, which is too big to analyse in a browser tab. Try a smaller date range.");
      return;
    }
    setBusy("file");
    try {
      const engine = await loadEngine();
      const table = await engine.parseFile(file);
      if (table.rows.length === 0) {
        setError(COPY.start.emptyFile);
        return;
      }
      onLoaded(table);
    } catch (e) {
      setError(e instanceof Error && e.message ? e.message : COPY.start.parseError);
    } finally {
      setBusy(null);
    }
  }

  async function handleSample() {
    setError(null);
    setBusy("sample");
    try {
      const engine = await loadEngine();
      onLoaded(engine.generateSample());
    } catch {
      setError(COPY.start.sampleError);
    } finally {
      setBusy(null);
    }
  }

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setDrag(false);
    const f = e.dataTransfer.files[0];
    if (f) void handleFile(f);
  };

  return (
    <>
      <section className="hero" aria-labelledby="hero-title">
        <div className="container">
          <h1 id="hero-title">{COPY.start.heroTitle}</h1>
          <p className="lead">{COPY.start.heroLead}</p>
          <p className="privacy-banner">
            <span aria-hidden="true">🔒</span>
            <span>{COPY.start.privacy}</span>
          </p>
        </div>
      </section>

      <div className="container">
        <h2 className="sr-only">{COPY.start.stepsTitle}</h2>
        <ol className="steps">
          {COPY.start.steps.map((s, i) => (
            <li key={s.t}>
              <span className="step-num" aria-hidden="true">
                {i + 1}
              </span>
              <h3 style={{ fontSize: "1.05rem" }}>
                <span className="sr-only">Step {i + 1}: </span>
                {s.t}
              </h3>
              <p className="muted">{s.d}</p>
            </li>
          ))}
        </ol>

        {note ? (
          <div style={{ marginBottom: 16 }}>
            <Alert tone="info" role="status">
              {note}
            </Alert>
          </div>
        ) : null}
        {error ? (
          <div style={{ marginBottom: 16 }}>
            <Alert tone="error" title={COPY.start.parseError}>
              <p>{error}</p>
              <p>{COPY.start.parseErrorHelp}</p>
            </Alert>
          </div>
        ) : null}
        <div aria-live="polite" className="sr-only">
          {busy ? COPY.start.parsing : ""}
        </div>

        <div className="action-grid">
          <section className="action-card" aria-labelledby="sample-h">
            <Pill tone="synthetic">{COPY.start.sampleBadge}</Pill>
            <h2 id="sample-h">{COPY.start.sampleTitle}</h2>
            <p className="muted">{COPY.start.sampleBody}</p>
            <div style={{ marginTop: "auto" }}>
              <button
                type="button"
                className="btn btn-primary"
                disabled={busy !== null}
                onClick={() => {
                  void handleSample();
                }}
              >
                {busy === "sample" ? COPY.start.parsing : COPY.start.sampleButton}
              </button>
            </div>
          </section>

          <section className="action-card pink" aria-labelledby="upload-h">
            <Pill tone="teal">🔒 Stays in your browser</Pill>
            <h2 id="upload-h">{COPY.start.uploadTitle}</h2>
            <div
              className={`dropzone${drag ? " drag" : ""}`}
              onDragOver={(e) => {
                e.preventDefault();
                setDrag(true);
              }}
              onDragLeave={() => {
                setDrag(false);
              }}
              onDrop={onDrop}
            >
              <p>{COPY.start.dropHint}</p>
              <input
                ref={input}
                id="file-input"
                className="sr-only"
                type="file"
                accept={ACCEPT}
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) void handleFile(f);
                  e.target.value = "";
                }}
              />
              <button
                type="button"
                className="btn btn-primary"
                style={{ marginTop: 10 }}
                disabled={busy !== null}
                onClick={() => input.current?.click()}
              >
                {busy === "file" ? COPY.start.parsing : COPY.start.uploadButton}
              </button>
            </div>
            <p className="small muted">{COPY.start.formats}</p>
            <p className="small muted">{COPY.start.needs}</p>
            <p className="small">
              {COPY.start.realData}{" "}
              <a href={UCI_URL} target="_blank" rel="noreferrer noopener">
                {COPY.start.realDataLink}
              </a>
              .
            </p>
          </section>
        </div>
      </div>
    </>
  );
}
