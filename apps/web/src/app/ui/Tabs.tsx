import { useRef } from "react";
import type { CSSProperties, KeyboardEvent, ReactNode } from "react";

export interface TabDef {
  id: string;
  label: string;
  color?: string;
}

interface Props {
  tabs: TabDef[];
  active: string;
  onChange: (id: string) => void;
  label: string;
  children: ReactNode;
  idPrefix?: string;
}

/** WAI-ARIA tabs: roving tabindex, arrow keys, Home/End. Only the active panel is rendered. */
export function Tabs({ tabs, active, onChange, label, children, idPrefix = "tab" }: Props) {
  const refs = useRef<Record<string, HTMLButtonElement | null>>({});

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const i = tabs.findIndex((t) => t.id === active);
    let next = -1;
    if (e.key === "ArrowRight") next = (i + 1) % tabs.length;
    else if (e.key === "ArrowLeft") next = (i - 1 + tabs.length) % tabs.length;
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = tabs.length - 1;
    if (next >= 0) {
      e.preventDefault();
      const t = tabs[next];
      if (t) {
        onChange(t.id);
        refs.current[t.id]?.focus();
      }
    }
  };

  return (
    <div>
      <div className="tablist" role="tablist" aria-label={label} onKeyDown={onKeyDown}>
        {tabs.map((t) => (
          <button
            key={t.id}
            ref={(el) => {
              refs.current[t.id] = el;
            }}
            id={`${idPrefix}-${t.id}`}
            type="button"
            role="tab"
            className="tab"
            style={t.color ? ({ "--tab-color": t.color } as CSSProperties) : undefined}
            aria-selected={t.id === active}
            aria-controls={`${idPrefix}-panel-${t.id}`}
            tabIndex={t.id === active ? 0 : -1}
            onClick={() => {
              onChange(t.id);
            }}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div
        role="tabpanel"
        id={`${idPrefix}-panel-${active}`}
        aria-labelledby={`${idPrefix}-${active}`}
        tabIndex={0}
      >
        {children}
      </div>
    </div>
  );
}
