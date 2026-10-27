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
import { init, use as registerEcharts } from "echarts/core";
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

export { init };
