import type { CSSProperties, ReactNode } from "react";
import type { RiskBand, SegmentKey } from "../../engine";
import { bandMeta, segmentMeta } from "../meta";

export type PillTone = "ok" | "bad" | "warn" | "info" | "vio" | "teal" | "muted" | "synthetic";

export function Pill({ tone = "muted", children }: { tone?: PillTone; children: ReactNode }) {
  return <span className={`pill pill-${tone}`}>{children}</span>;
}

export function BandPill({ band }: { band: RiskBand }) {
  const m = bandMeta(band);
  return (
    <span className={`pill ${m.pillClass}`}>
      <span aria-hidden="true">{m.icon}</span>
      {m.label}
    </span>
  );
}

export function SegmentPill({ segment, label }: { segment: SegmentKey; label?: string }) {
  const m = segmentMeta(segment);
  return (
    <span
      className="pill"
      style={{ background: "var(--surface-2)", color: "var(--text)", borderColor: m.color }}
    >
      <span aria-hidden="true" style={{ color: m.color }}>
        {m.icon}
      </span>
      {label ?? m.name}
    </span>
  );
}

const ICONS = { info: "i", warning: "!", error: "×", success: "✓" } as const;

export function Alert({
  tone = "info",
  title,
  children,
  role,
}: {
  tone?: "info" | "warning" | "error" | "success";
  title?: string;
  children?: ReactNode;
  role?: "alert" | "status";
}) {
  return (
    <div className={`alert alert-${tone}`} role={role ?? (tone === "error" ? "alert" : undefined)}>
      <span className="alert-icon" aria-hidden="true">
        {ICONS[tone]}
      </span>
      <div>
        {title ? <p className="alert-title">{title}</p> : null}
        {children ? <div>{children}</div> : null}
      </div>
    </div>
  );
}

export function KpiTile({
  label,
  value,
  hint,
  color,
}: {
  label: string;
  value: string;
  hint?: string;
  color?: string;
}) {
  const style = color ? ({ "--kpi": color } as CSSProperties) : undefined;
  return (
    <div className="kpi" style={style}>
      <p className="kpi-label">{label}</p>
      <p className="kpi-value">{value}</p>
      {hint ? <p className="kpi-hint">{hint}</p> : null}
    </div>
  );
}
