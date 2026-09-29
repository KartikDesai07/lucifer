// Shared by the page (its skeleton) and SalesChart (its canvas). A module of its
// own so the page can reserve the chart's exact height WITHOUT a static import
// of SalesChart.tsx — that would pull Chart.js into the first bundle.
export const SALES_CHART_HEIGHT_PX = 240;
const LEGEND_ROW_PX = 28;
/** The Sales card's body: legend row + canvas. */
export const SALES_CHART_BODY_PX = SALES_CHART_HEIGHT_PX + LEGEND_ROW_PX;
