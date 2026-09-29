// Shared by every report page (its skeleton + prop types) and ReportChart
// (its canvas). A module of its own so a page can reserve the chart's exact
// height and type its `bars`/`line` props WITHOUT any import — value or type
// — from ReportChart.tsx itself, which would pull Chart.js into the first
// bundle (same reasoning as components/dashboard/chart-size.ts; the Dashboard
// avoids the same trap by never importing a SalesChart type either).
export const REPORT_CHART_HEIGHT_PX = 240;
const LEGEND_ROW_PX = 28;
/** The chart card's body: legend row + canvas (desktop height; the canvas itself is shorter on a phone). */
export const REPORT_CHART_BODY_PX = REPORT_CHART_HEIGHT_PX + LEGEND_ROW_PX;

export interface ReportChartBar {
  name: string;
  values: number[];
  tone: "primary" | "ink";
}

export interface ReportChartLine {
  name: string;
  values: number[];
}
