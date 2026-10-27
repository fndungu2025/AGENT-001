import { useEffect, useState } from "react";

export interface ChartColors {
  text: string;
  muted: string;
  border: string;
  surface: string;
  brand: string;
  dark: boolean;
}

function read(): ChartColors {
  const cs = getComputedStyle(document.documentElement);
  const v = (name: string, fallback: string) => cs.getPropertyValue(name).trim() || fallback;
  const dark =
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-color-scheme: dark)").matches;
  return {
    text: v("--text", "#1b1f2a"),
    muted: v("--muted", "#4b5563"),
    border: v("--border", "#d9dcea"),
    surface: v("--surface", "#ffffff"),
    brand: v("--brand", "#4338ca"),
    dark,
  };
}

export function prefersReducedMotion(): boolean {
  return (
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

/** Theme colours that follow prefers-color-scheme. */
export function useChartColors(): ChartColors {
  const [colors, setColors] = useState<ChartColors>(read);
  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => {
      setColors(read());
    };
    mq.addEventListener("change", onChange);
    return () => {
      mq.removeEventListener("change", onChange);
    };
  }, []);
  return colors;
}

/** Shared axis styling so every chart reads the same. */
export function axisStyle(c: ChartColors) {
  return {
    axisLabel: { color: c.muted },
    axisLine: { lineStyle: { color: c.border } },
    axisTick: { lineStyle: { color: c.border } },
    splitLine: { lineStyle: { color: c.border, opacity: 0.6 } },
    nameTextStyle: { color: c.muted },
  };
}
