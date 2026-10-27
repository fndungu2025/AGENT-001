import type { Progress } from "../../engine";

export interface StepDef {
  stage: Progress["stage"];
  label: string;
}

/** Stage list driven by Progress.stage. Status is text ("Done", "In progress"), not just colour. */
export function Stepper({
  steps,
  current,
}: {
  steps: StepDef[];
  current: Progress["stage"] | null;
}) {
  const idx = current === null ? -1 : steps.findIndex((s) => s.stage === current);
  const allDone = current === "done";
  return (
    <ol className="stepper">
      {steps.map((s, i) => {
        const state = allDone || i < idx ? "done" : i === idx ? "active" : "todo";
        return (
          <li
            key={s.stage}
            data-state={state}
            aria-current={state === "active" ? "step" : undefined}
          >
            <span className="step-dot" aria-hidden="true">
              {state === "done" ? "✓" : i + 1}
            </span>
            <span style={{ fontWeight: 700 }}>{s.label}</span>
            <span className="muted small" style={{ marginLeft: "auto" }}>
              {state === "done" ? "Done" : state === "active" ? "In progress" : "Waiting"}
            </span>
          </li>
        );
      })}
    </ol>
  );
}
