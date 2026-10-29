// Modular ECharts registration: only the pieces the dashboard uses. Loaded lazily with the
// dashboard so the start screen stays small.
import { BarChart, HeatmapChart, LineChart, ScatterChart, TreemapChart } from "echarts/charts";
import {
  AriaComponent,
  DatasetComponent,
  GridComponent,
  LegendComponent,
  MarkLineComponent,
  TooltipComponent,
  VisualMapComponent,
} from "echarts/components";
import { init as echartsInit, use as registerEcharts } from "echarts/core";
import { CanvasRenderer } from "echarts/renderers";

registerEcharts([
  BarChart,
  LineChart,
  ScatterChart,
  HeatmapChart,
  TreemapChart,
  AriaComponent,
  DatasetComponent,
  GridComponent,
  LegendComponent,
  MarkLineComponent,
  TooltipComponent,
  VisualMapComponent,
  CanvasRenderer,
]);

/** True when the browser can draw on a canvas (jsdom and some locked-down browsers cannot). */
function canvasSupported(): boolean {
  try {
    return Boolean(document.createElement("canvas").getContext("2d"));
  } catch {
    return false;
  }
}

/** Same as ECharts' `init`, but fails cleanly (the chart shows its table and a notice) instead of
 *  crashing the page when canvas drawing is unavailable. */
export function init(...args: Parameters<typeof echartsInit>): ReturnType<typeof echartsInit> {
  if (!canvasSupported()) throw new Error("Canvas drawing is not available in this browser.");
  return echartsInit(...args);
}
