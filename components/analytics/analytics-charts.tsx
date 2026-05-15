// components/admin/analytics/analytics-charts.tsx
// ─────────────────────────────────────────────────────────────────────────────
// Chart wrappers.
//   Bars, LineChart          → @mui/x-charts (already in deps)
//   BubbleChart, Waterfall   → hand-rolled SVG (no MUI equivalent)
//   Sparkline, HeatCell,
//   BoxPlot                  → SVG / plain JSX (lightweight, no deps)
// ─────────────────────────────────────────────────────────────────────────────

"use client";

import { BarChart as MuiBarChart }  from "@mui/x-charts/BarChart";
import { LineChart as MuiLineChart } from "@mui/x-charts/LineChart";

// ─── Shared design tokens ─────────────────────────────────────────────────────

const AXIS  = "#9CA3AF";
const GRID  = "#F3F4F6";
const FONT  = "'Inter',-apple-system,sans-serif";

const TICK  = { fontSize: 10, fill: AXIS, fontFamily: FONT } as const;
const CHART_SX = {
  fontFamily: FONT,
  "& .MuiChartsAxis-line":    { stroke: GRID },
  "& .MuiChartsAxis-tick":    { stroke: GRID },
  "& .MuiChartsGrid-line":    { stroke: GRID, strokeDasharray: "4 4" },
  "& .MuiChartsTooltip-root": {
    fontFamily: FONT,
    fontSize: 11,
    borderRadius: 6,
    boxShadow: "0 4px 20px rgba(0,0,0,0.12)",
    background: "rgba(17,24,39,0.95)",
  },
  "& text": { fontFamily: `${FONT} !important` },
} as const;

// ─── Bars ─────────────────────────────────────────────────────────────────────

interface BarsProps {
  labels:      string[];
  series:      { label: string; data: number[]; color: string }[];
  height?:     number;
  horizontal?: boolean;
  stacked?:    boolean;
  showLegend?: boolean;
  yFormat?:    (v: number) => string;
}

export function Bars({
  labels, series, height = 220,
  horizontal, stacked, showLegend, yFormat,
}: BarsProps) {
  const fmt = (v: number | null) =>
    v === null ? "—" : yFormat ? yFormat(v) : String(v);

  const muiSeries = series.map(s => ({
    label:          s.label,
    data:           s.data,
    color:          s.color,
    stack:          stacked ? "total" : undefined,
    valueFormatter: (v: number | null) => fmt(v),
  }));

  // Axis configs differ for horizontal vs vertical
  const bandAxis  = { data: labels, scaleType: "band" as const, tickLabelStyle: TICK, tickSize: 0 };
  const valueAxis = {
    scaleType:      "linear" as const,
    tickLabelStyle: TICK,
    tickSize:       0,
    valueFormatter: yFormat ? (v: number) => yFormat(v) : undefined,
  };

  return (
    <MuiBarChart
      height={height}
      layout={horizontal ? "horizontal" : "vertical"}
      series={muiSeries}
      xAxis={[horizontal ? valueAxis : bandAxis]}
      yAxis={[horizontal ? bandAxis  : valueAxis]}
      margin={{ top: showLegend ? 32 : 8, bottom: 28, left: yFormat ? 48 : 32, right: 8 }}
      borderRadius={4}
      grid={horizontal ? { vertical: true } : { horizontal: true }}
      slots={showLegend ? undefined : { legend: () => null }}
      sx={{ ...CHART_SX, width: "100% !important" }}
      skipAnimation={false}
    />
  );
}

// ─── LineChart ────────────────────────────────────────────────────────────────

interface LineSeriesItem {
  label:  string;
  data:   (number | null)[];
  color:  string;
  dashed?: boolean;
  fill?:   boolean;
}

interface LineProps {
  labels:          string[];
  series:          LineSeriesItem[];
  height?:         number;
  yFormat?:        (v: number) => string;
  showLegend?:     boolean;
  yMin?:           number;
  yMax?:           number;
  referenceLine?:  { y: number; label: string; color: string };
}

export function LineChart({
  labels, series, height = 220,
  yFormat, showLegend, yMin, yMax, referenceLine,
}: LineProps) {
  // Assign stable IDs so we can target dashed series via sx
  const dashedIds = series
    .map((s, i) => s.dashed ? `line-series-${i}` : null)
    .filter((id): id is string => id !== null);

  const muiSeries = series.map((s, i) => ({
    id:             `line-series-${i}`,
    label:          s.label,
    data:           s.data,
    color:          s.color,
    area:           !!s.fill,
    curve:          "catmullRom" as const,
    showMark:       false as const,
    valueFormatter: (v: number | null) =>
      v === null ? "—" : yFormat ? yFormat(v) : String(v),
  }));

  // Reference line added as a flat series — styled dashed via sx
  const REF_ID = "line-series-ref";
  if (referenceLine) {
    muiSeries.push({
      id:             REF_ID,
      label:          referenceLine.label,
      data:           labels.map(() => referenceLine.y),
      color:          referenceLine.color,
      area:           false,
      curve:          "catmullRom" as const,
      showMark:       false as const,
      valueFormatter: (v: number | null) =>
        v === null ? "—" : yFormat ? yFormat(v) : String(v),
    });
  }

  // Build sx: dashed selectors per series + ref line
  const dashedSx = Object.fromEntries(
    [...dashedIds, referenceLine ? REF_ID : null]
      .filter((id): id is string => id !== null)
      .map(id => [`& .MuiLineElement-series-${id}`, { strokeDasharray: "4 4" }])
  );

  return (
    <MuiLineChart
      height={height}
      series={muiSeries}
      xAxis={[{
        data:           labels,
        scaleType:      "band",
        tickLabelStyle: TICK,
        tickSize:       0,
      }]}
      yAxis={[{
        scaleType:      "linear",
        min:            yMin,
        max:            yMax,
        tickLabelStyle: TICK,
        tickSize:       0,
        valueFormatter: yFormat ? (v: number) => yFormat(v) : undefined,
      }]}
      margin={{ top: showLegend ? 32 : 8, bottom: 28, left: yFormat ? 52 : 32, right: 8 }}
      grid={{ horizontal: true }}
      slots={showLegend ? undefined : { legend: () => null }}
      sx={{
        ...CHART_SX,
        width: "100% !important",
        "& .MuiAreaElement-root":  { fillOpacity: 0.12 },
        "& .MuiLineElement-root":  { strokeWidth: 2 },
        "& .MuiMarkElement-root":  { display: "none" },
        ...dashedSx,
      }}
      skipAnimation={false}
    />
  );
}

// ─── BubbleChart — SVG ────────────────────────────────────────────────────────
// MUI X Charts has ScatterChart but no native bubble sizing.
// Hand-rolled SVG gives full control over radius, labels, quadrant lines.

interface BubbleProps {
  points:  { x: number; y: number; r: number; label: string; color: string }[];
  height?: number;
  xLabel:  string;
  yLabel:  string;
  xMax?:   number;
  yMin?:   number;
  yMax?:   number;
}

export function BubbleChart({
  points, height = 320,
  xLabel, yLabel,
  xMax = 100, yMin = -20, yMax = 50,
}: BubbleProps) {
  const W = 560, H = height;
  const pad = { top: 20, right: 20, bottom: 44, left: 52 };
  const cW  = W - pad.left - pad.right;
  const cH  = H - pad.top  - pad.bottom;

  const sx = (x: number) => pad.left  + (x / xMax)              * cW;
  const sy = (y: number) => pad.top   + (1 - (y - yMin) / (yMax - yMin)) * cH;

  const xTicks = [0, 25, 50, 75, 100].filter(v => v <= xMax);
  const yRange = yMax - yMin;
  const yStep  = yRange <= 40 ? 10 : yRange <= 80 ? 20 : 25;
  const yTicks: number[] = [];
  for (let v = Math.ceil(yMin / yStep) * yStep; v <= yMax; v += yStep) yTicks.push(v);

  return (
    <svg width="100%" viewBox={`0 0 ${W} ${H}`} style={{ display: "block", overflow: "visible" }}>
      {/* grid */}
      {xTicks.map(v => (
        <g key={v}>
          <line x1={sx(v)} x2={sx(v)} y1={pad.top} y2={pad.top + cH} stroke={GRID} />
          <text x={sx(v)} y={pad.top + cH + 14} fontSize="9" textAnchor="middle" fill={AXIS}>{v}</text>
        </g>
      ))}
      {yTicks.map(v => (
        <g key={v}>
          <line x1={pad.left} x2={pad.left + cW} y1={sy(v)} y2={sy(v)} stroke={GRID} />
          <text x={pad.left - 6} y={sy(v) + 3} fontSize="9" textAnchor="end" fill={AXIS}>{v}</text>
        </g>
      ))}
      {/* zero reference lines */}
      {yMin < 0 && yMax > 0 && (
        <line x1={pad.left} x2={pad.left + cW} y1={sy(0)} y2={sy(0)}
          stroke={AXIS} strokeWidth="1" strokeDasharray="3 3" />
      )}
      {/* axis labels */}
      <text x={pad.left + cW / 2} y={H - 4} fontSize="10" textAnchor="middle" fill={AXIS}>{xLabel}</text>
      <text
        transform={`translate(12, ${pad.top + cH / 2}) rotate(-90)`}
        fontSize="10" textAnchor="middle" fill={AXIS}
      >{yLabel}</text>
      {/* bubbles */}
      {points.map((p, i) => (
        <g key={i}>
          <circle
            cx={sx(p.x)} cy={sy(p.y)} r={Math.max(4, p.r)}
            fill={p.color} fillOpacity="0.75"
            stroke={p.color} strokeWidth="1.5"
          />
          <text
            x={sx(p.x)} y={sy(p.y) - Math.max(4, p.r) - 4}
            fontSize="9" textAnchor="middle" fill="#374151" fontWeight="500"
          >{p.label}</text>
        </g>
      ))}
    </svg>
  );
}

// ─── Waterfall — SVG ──────────────────────────────────────────────────────────

interface WaterfallStep {
  label: string;
  value: number;
  type:  "start" | "delta" | "end";
}

export function Waterfall({
  steps, height = 260, format,
}: {
  steps:   WaterfallStep[];
  height?: number;
  format?: (v: number) => string;
}) {
  const W   = 560;
  const pad = { top: 20, right: 16, bottom: 32, left: 52 };
  const cW  = W - pad.left - pad.right;
  const cH  = height - pad.top - pad.bottom;

  // Build running totals → floating bar [base, top]
  let running = 0;
  const bars: { base: number; top: number; color: string; label: string; value: number }[] = [];

  steps.forEach(s => {
    if (s.type === "start") {
      bars.push({ base: 0, top: s.value, color: "#6B7280", label: s.label, value: s.value });
      running = s.value;
    } else if (s.type === "end") {
      bars.push({ base: 0, top: running, color: "#6B7280", label: s.label, value: running });
    } else {
      const next = running + s.value;
      bars.push({
        base:  s.value >= 0 ? running : next,
        top:   s.value >= 0 ? next    : running,
        color: s.value >= 0 ? "#10B981" : "#EF4444",
        label: s.label,
        value: s.value,
      });
      running = next;
    }
  });

  const allVals = bars.flatMap(b => [b.base, b.top]);
  const dataMax = Math.max(...allVals, 0);
  const dataMin = Math.min(...allVals, 0);
  const range   = dataMax - dataMin || 1;
  const barW    = Math.max(8, (cW / bars.length) * 0.6);

  const sy  = (v: number) => pad.top + (1 - (v - dataMin) / range) * cH;
  const sx  = (i: number) => pad.left + (i + 0.5) * (cW / bars.length);

  // Y axis ticks
  const step  = Math.pow(10, Math.floor(Math.log10(range))) / 2;
  const yTicks: number[] = [];
  for (let v = Math.floor(dataMin / step) * step; v <= dataMax + step; v += step) {
    if (v >= dataMin && v <= dataMax) yTicks.push(Math.round(v * 100) / 100);
  }

  return (
    <svg width="100%" viewBox={`0 0 ${W} ${height}`} style={{ display: "block" }}>
      {/* grid + y-axis */}
      {yTicks.map(v => (
        <g key={v}>
          <line x1={pad.left} x2={pad.left + cW} y1={sy(v)} y2={sy(v)} stroke={GRID} />
          <text x={pad.left - 6} y={sy(v) + 3} fontSize="9" textAnchor="end" fill={AXIS}>
            {format ? format(v) : v}
          </text>
        </g>
      ))}
      {/* zero line */}
      {dataMin < 0 && dataMax > 0 && (
        <line x1={pad.left} x2={pad.left + cW} y1={sy(0)} y2={sy(0)}
          stroke={AXIS} strokeWidth="1" strokeDasharray="3 3" />
      )}
      {/* connector lines between bars */}
      {bars.slice(0, -1).map((b, i) => (
        <line key={i}
          x1={sx(i) + barW / 2} x2={sx(i + 1) - barW / 2}
          y1={sy(b.top)} y2={sy(b.top)}
          stroke="#D1D5DB" strokeWidth="1" strokeDasharray="2 2"
        />
      ))}
      {/* bars */}
      {bars.map((b, i) => {
        const barTop  = sy(b.top);
        const barBase = sy(b.base);
        const barH    = Math.max(2, barBase - barTop);
        return (
          <g key={i}>
            <rect
              x={sx(i) - barW / 2} y={barTop}
              width={barW} height={barH}
              fill={b.color} fillOpacity="0.85" rx="3"
            />
            {/* value label */}
            <text
              x={sx(i)} y={barTop - 4}
              fontSize="9" textAnchor="middle" fill={b.color} fontWeight="600"
            >
              {format
                ? format(b.value)
                : `${b.value >= 0 && b.base !== 0 ? "+" : ""}${b.value.toFixed(0)}`}
            </text>
            {/* x label */}
            <text
              x={sx(i)} y={pad.top + cH + 16}
              fontSize="9" textAnchor="middle" fill={AXIS}
            >{b.label}</text>
          </g>
        );
      })}
    </svg>
  );
}

// ─── Sparkline — SVG polyline ─────────────────────────────────────────────────

export function Sparkline({
  data, color = "#6366F1", width = 80, height = 24,
}: {
  data:    number[];
  color?:  string;
  width?:  number;
  height?: number;
}) {
  if (!data.length) return <span style={{ width, height, display: "inline-block" }} />;
  const max   = Math.max(...data, 1);
  const min   = Math.min(...data, 0);
  const range = max - min || 1;
  const stepX = width / Math.max(data.length - 1, 1);
  const pts   = data
    .map((v, i) => `${i * stepX},${height - ((v - min) / range) * height}`)
    .join(" ");
  return (
    <svg width={width} height={height} style={{ display: "inline-block", verticalAlign: "middle" }}>
      <polyline
        points={pts}
        fill="none"
        stroke={color}
        strokeWidth="1.5"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </svg>
  );
}

// ─── HeatCell ─────────────────────────────────────────────────────────────────

export function HeatCell({ value, max = 100 }: { value: number | null; max?: number }) {
  if (value === null) {
    return (
      <div
        className="bg-gray-50 text-gray-300 text-[10px] flex items-center justify-center rounded"
        style={{ height: 32 }}
      >—</div>
    );
  }
  const ratio = Math.min(1, value / max);
  const bg =
    value === 0 ? "#FEF2F2" :
    value < 10  ? "#FEE2E2" :
    value < 25  ? "#FEF3C7" :
    value < 40  ? "#FDE68A" :
    value < 55  ? "#A7F3D0" :
    value < 70  ? "#6EE7B7" :
                  "#10B981";
  const text =
    value < 25 ? "#7F1D1D" :
    value < 55 ? "#78350F" :
                 "#064E3B";
  return (
    <div
      className="text-[11px] font-bold flex items-center justify-center rounded transition-colors"
      style={{ background: bg, color: text, height: 32, opacity: 0.4 + ratio * 0.6 }}
      title={`${value}%`}
    >
      {value}%
    </div>
  );
}

// ─── BoxPlot — SVG ────────────────────────────────────────────────────────────

interface BoxPlotProps {
  rows: {
    label:  string;
    min:    number;
    q1:     number;
    median: number;
    q3:     number;
    max:    number;
    sample: number;
  }[];
  height?: number;
}

export function BoxPlot({ rows, height = 240 }: BoxPlotProps) {
  if (!rows.length) {
    return <div className="text-xs text-gray-400 py-8 text-center">No data.</div>;
  }
  const W      = 600;
  const rowH   = 36;
  const totalH = Math.max(height, rows.length * rowH + 40);
  const labelW = 120;
  const padR   = 50;
  const sx = (v: number) => labelW + (v / 100) * (W - labelW - padR);

  return (
    <svg width="100%" viewBox={`0 0 ${W} ${totalH}`} style={{ display: "block" }}>
      {[0, 25, 50, 75, 100].map(v => (
        <g key={v}>
          <line x1={sx(v)} x2={sx(v)} y1="20" y2={totalH - 20} stroke={GRID} strokeWidth="1" />
          <text x={sx(v)} y={totalH - 6} fontSize="9" textAnchor="middle" fill={AXIS}>{v}</text>
        </g>
      ))}
      {rows.map((r, i) => {
        const y = 24 + i * rowH;
        return (
          <g key={r.label}>
            <text x={labelW - 8} y={y + 14} fontSize="11" textAnchor="end" fill="#374151" fontWeight="500">
              {r.label}{" "}
              <tspan fill={AXIS} fontWeight="400">({r.sample})</tspan>
            </text>
            {/* whiskers */}
            <line x1={sx(r.min)} x2={sx(r.max)} y1={y + 14} y2={y + 14} stroke={AXIS} strokeWidth="1" />
            <line x1={sx(r.min)} x2={sx(r.min)} y1={y + 6}  y2={y + 22} stroke={AXIS} strokeWidth="1" />
            <line x1={sx(r.max)} x2={sx(r.max)} y1={y + 6}  y2={y + 22} stroke={AXIS} strokeWidth="1" />
            {/* IQR box */}
            <rect
              x={sx(r.q1)} y={y + 4}
              width={sx(r.q3) - sx(r.q1)} height={20}
              fill="#6366F1" fillOpacity="0.15"
              stroke="#6366F1" strokeWidth="1" rx="2"
            />
            {/* median */}
            <line
              x1={sx(r.median)} x2={sx(r.median)}
              y1={y + 4} y2={y + 24}
              stroke="#6366F1" strokeWidth="2"
            />
          </g>
        );
      })}
    </svg>
  );
}