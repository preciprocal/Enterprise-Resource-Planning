// components/admin/analytics/analytics-charts.tsx
// ─────────────────────────────────────────────────────────────────────────────
// Chart.js wrappers. Each chart builds its own typed ChartConfiguration object
// so TypeScript narrows scales correctly per chart type — no casts needed.
// ─────────────────────────────────────────────────────────────────────────────

"use client";

import {
  Chart,
  BarController, BarElement,
  LineController, LineElement, PointElement,
  BubbleController,
  CategoryScale, LinearScale,
  Tooltip, Legend, Filler,
  type ChartConfiguration,
} from "chart.js/auto";
import { useEffect, useRef } from "react";

// Register controllers + scales once
Chart.register(
  BarController, BarElement,
  LineController, LineElement, PointElement,
  BubbleController,
  CategoryScale, LinearScale,
  Tooltip, Legend, Filler,
);

// ─── Design tokens ───────────────────────────────────────────────────────────

const FONT       = '"Geist", system-ui, -apple-system, sans-serif';
const AXIS       = "#9CA3AF";
const GRID       = "#F3F4F6";
const TOOLTIP_BG = "rgba(17, 24, 39, 0.95)";
const LABEL      = "#6B7280";

// ─── Container ───────────────────────────────────────────────────────────────

function ChartFrame({ height, children }: { height: number; children: React.ReactNode }) {
  return (
    <div style={{ position: "relative", width: "100%", height }}>
      {children}
    </div>
  );
}

// ─── Bars ────────────────────────────────────────────────────────────────────

interface BarsProps {
  labels: string[];
  series: { label: string; data: number[]; color: string }[];
  height?: number;
  horizontal?: boolean;
  stacked?: boolean;
  showLegend?: boolean;
  yFormat?: (v: number) => string;
}

export function Bars({
  labels, series, height = 220,
  horizontal, stacked, showLegend, yFormat,
}: BarsProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const chartRef  = useRef<Chart<"bar"> | null>(null);

  useEffect(() => {
    if (!canvasRef.current) return;
    if (chartRef.current) { chartRef.current.destroy(); chartRef.current = null; }

    const config: ChartConfiguration<"bar"> = {
      type: "bar",
      data: {
        labels,
        datasets: series.map(s => ({
          label: s.label,
          data: s.data,
          backgroundColor: s.color,
          borderRadius: 4,
          borderSkipped: false,
          maxBarThickness: 40,
        })),
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        indexAxis: horizontal ? "y" : "x",
        animation: { duration: 400 },
        plugins: {
          legend: {
            display: !!showLegend,
            position: "top",
            labels: {
              font: { family: FONT, size: 11 },
              color: LABEL,
              boxWidth: 10,
              boxHeight: 10,
              padding: 12,
            },
          },
          tooltip: {
            backgroundColor: TOOLTIP_BG,
            titleFont: { family: FONT, size: 11, weight: "bold" },
            bodyFont:  { family: FONT, size: 11 },
            padding: 8,
            cornerRadius: 6,
            displayColors: false,
            callbacks: yFormat ? {
              label: (c) => {
                const v = horizontal
                  ? (c.parsed as { x: number; y: number }).x
                  : (c.parsed as { x: number; y: number }).y;
                return `${c.dataset.label ?? ""}: ${yFormat(v)}`;
              },
            } : undefined,
          },
        },
        scales: {
          x: {
            type: horizontal ? "linear" : "category",
            stacked: !!stacked,
            beginAtZero: horizontal ? true : undefined,
            ticks: {
              font: { family: FONT, size: 10 },
              color: AXIS,
              callback: (horizontal && yFormat)
                ? (v) => yFormat(typeof v === "number" ? v : Number(v))
                : undefined,
            },
            grid: horizontal ? { color: GRID } : { display: false },
          },
          y: {
            type: horizontal ? "category" : "linear",
            stacked: !!stacked,
            beginAtZero: horizontal ? undefined : true,
            ticks: {
              font: { family: FONT, size: 10 },
              color: AXIS,
              callback: (!horizontal && yFormat)
                ? (v) => yFormat(typeof v === "number" ? v : Number(v))
                : undefined,
            },
            grid: horizontal ? { display: false } : { color: GRID },
          },
        },
      },
    };

    chartRef.current = new Chart(canvasRef.current, config);

    return () => { chartRef.current?.destroy(); chartRef.current = null; };
  }, [labels, series, horizontal, stacked, showLegend, yFormat]);

  return <ChartFrame height={height}><canvas ref={canvasRef} /></ChartFrame>;
}

// ─── Line ────────────────────────────────────────────────────────────────────

interface LineProps {
  labels: string[];
  series: {
    label: string;
    data: (number | null)[];
    color: string;
    dashed?: boolean;
    fill?: boolean;
  }[];
  height?: number;
  yFormat?: (v: number) => string;
  showLegend?: boolean;
  yMin?: number;
  yMax?: number;
  referenceLine?: { y: number; label: string; color: string };
}

export function LineChart({
  labels, series, height = 220,
  yFormat, showLegend, yMin, yMax, referenceLine,
}: LineProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const chartRef  = useRef<Chart<"line"> | null>(null);

  useEffect(() => {
    if (!canvasRef.current) return;
    if (chartRef.current) { chartRef.current.destroy(); chartRef.current = null; }

    const datasets: ChartConfiguration<"line">["data"]["datasets"] = series.map(s => ({
      label: s.label,
      data: s.data,
      borderColor: s.color,
      backgroundColor: s.fill ? s.color + "22" : s.color,
      fill: !!s.fill,
      tension: 0.3,
      borderWidth: 2,
      pointRadius: s.data.length > 30 ? 0 : 3,
      pointHoverRadius: 5,
      borderDash: s.dashed ? [4, 4] : undefined,
      spanGaps: true,
    }));

    if (referenceLine) {
      datasets.push({
        label: referenceLine.label,
        data: labels.map(() => referenceLine.y),
        borderColor: referenceLine.color,
        borderWidth: 1,
        borderDash: [3, 3],
        pointRadius: 0,
        fill: false,
      });
    }

    const config: ChartConfiguration<"line"> = {
      type: "line",
      data: { labels, datasets },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: { duration: 400 },
        plugins: {
          legend: {
            display: !!showLegend,
            position: "top",
            labels: {
              font: { family: FONT, size: 11 },
              color: LABEL,
              boxWidth: 10,
              boxHeight: 10,
              padding: 12,
            },
          },
          tooltip: {
            backgroundColor: TOOLTIP_BG,
            titleFont: { family: FONT, size: 11, weight: "bold" },
            bodyFont:  { family: FONT, size: 11 },
            padding: 8,
            cornerRadius: 6,
            displayColors: false,
            callbacks: yFormat ? {
              label: (c) => {
                const y = (c.parsed as { x: number; y: number | null }).y;
                if (y === null || y === undefined) return `${c.dataset.label ?? ""}: —`;
                return `${c.dataset.label ?? ""}: ${yFormat(y)}`;
              },
            } : undefined,
          },
        },
        scales: {
          x: {
            type: "category",
            ticks: { font: { family: FONT, size: 10 }, color: AXIS },
            grid: { display: false },
          },
          y: {
            type: "linear",
            beginAtZero: true,
            min: yMin,
            max: yMax,
            ticks: {
              font: { family: FONT, size: 10 },
              color: AXIS,
              callback: yFormat
                ? (v) => yFormat(typeof v === "number" ? v : Number(v))
                : undefined,
            },
            grid: { color: GRID },
          },
        },
      },
    };

    chartRef.current = new Chart(canvasRef.current, config);

    return () => { chartRef.current?.destroy(); chartRef.current = null; };
  }, [labels, series, yFormat, showLegend, yMin, yMax, referenceLine]);

  return <ChartFrame height={height}><canvas ref={canvasRef} /></ChartFrame>;
}

// ─── Bubble (for feature ROI matrix) ─────────────────────────────────────────

interface BubbleProps {
  points: { x: number; y: number; r: number; label: string; color: string }[];
  height?: number;
  xLabel: string;
  yLabel: string;
  xMax?: number;
  yMin?: number;
  yMax?: number;
}

export function BubbleChart({
  points, height = 320, xLabel, yLabel,
  xMax = 100, yMin = -20, yMax = 50,
}: BubbleProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const chartRef  = useRef<Chart<"bubble"> | null>(null);

  useEffect(() => {
    if (!canvasRef.current) return;
    if (chartRef.current) { chartRef.current.destroy(); chartRef.current = null; }

    const config: ChartConfiguration<"bubble"> = {
      type: "bubble",
      data: {
        datasets: points.map(p => ({
          label: p.label,
          data: [{ x: p.x, y: p.y, r: p.r }],
          backgroundColor: p.color + "B3", // ~70% opacity
          borderColor: p.color,
          borderWidth: 1.5,
        })),
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: { duration: 400 },
        layout: { padding: 16 },
        plugins: {
          legend: { display: false },
          tooltip: {
            backgroundColor: TOOLTIP_BG,
            titleFont: { family: FONT, size: 11, weight: "bold" },
            bodyFont:  { family: FONT, size: 11 },
            padding: 8,
            cornerRadius: 6,
            displayColors: false,
            callbacks: {
              label: (c) => {
                const raw = c.raw as { x: number; y: number; r: number };
                return `${c.dataset.label}: ${raw.x.toFixed(1)}% adoption · ${raw.y >= 0 ? "+" : ""}${raw.y.toFixed(1)}pt retention`;
              },
            },
          },
        },
        scales: {
          x: {
            type: "linear",
            min: 0,
            max: xMax,
            ticks: { font: { family: FONT, size: 10 }, color: AXIS },
            grid: { color: GRID },
            title: { display: true, text: xLabel, font: { family: FONT, size: 11 }, color: LABEL },
          },
          y: {
            type: "linear",
            min: yMin,
            max: yMax,
            ticks: { font: { family: FONT, size: 10 }, color: AXIS },
            grid: { color: GRID },
            title: { display: true, text: yLabel, font: { family: FONT, size: 11 }, color: LABEL },
          },
        },
      },
    };

    chartRef.current = new Chart(canvasRef.current, config);

    return () => { chartRef.current?.destroy(); chartRef.current = null; };
  }, [points, xLabel, yLabel, xMax, yMin, yMax]);

  return <ChartFrame height={height}><canvas ref={canvasRef} /></ChartFrame>;
}

// ─── Waterfall (built on bar with floating bars) ─────────────────────────────

interface WaterfallStep {
  label: string;
  value: number;        // signed
  type: "start" | "delta" | "end";
}

export function Waterfall({
  steps, height = 260, format,
}: {
  steps: WaterfallStep[];
  height?: number;
  format?: (v: number) => string;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const chartRef  = useRef<Chart<"bar"> | null>(null);

  useEffect(() => {
    if (!canvasRef.current) return;
    if (chartRef.current) { chartRef.current.destroy(); chartRef.current = null; }

    // Build floating bars: each bar is [base, top]
    let running = 0;
    const ranges: [number, number][] = [];
    const colors: string[] = [];

    steps.forEach(s => {
      if (s.type === "start" || s.type === "end") {
        ranges.push([0, s.value]);
        colors.push("#6B7280");
        running = s.value;
      } else {
        const next = running + s.value;
        if (s.value >= 0) {
          ranges.push([running, next]);
          colors.push("#10B981");
        } else {
          ranges.push([next, running]);
          colors.push("#EF4444");
        }
        running = next;
      }
    });

    const config: ChartConfiguration<"bar"> = {
      type: "bar",
      data: {
        labels: steps.map(s => s.label),
        datasets: [{
          label: "MRR",
          // Floating-bar [from, to] tuples are supported at runtime;
          // the type accepts number[] | [number, number][] via overloads
          data: ranges,
          backgroundColor: colors,
          borderRadius: 4,
          maxBarThickness: 56,
        }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: { duration: 400 },
        plugins: {
          legend: { display: false },
          tooltip: {
            backgroundColor: TOOLTIP_BG,
            titleFont: { family: FONT, size: 11, weight: "bold" },
            bodyFont:  { family: FONT, size: 11 },
            padding: 8,
            cornerRadius: 6,
            displayColors: false,
            callbacks: {
              label: (c) => {
                const s = steps[c.dataIndex];
                const v = s.value;
                return format ? format(v) : `${v >= 0 ? "+" : ""}${v.toFixed(2)}`;
              },
            },
          },
        },
        scales: {
          x: {
            type: "category",
            ticks: { font: { family: FONT, size: 10 }, color: AXIS },
            grid: { display: false },
          },
          y: {
            type: "linear",
            beginAtZero: true,
            ticks: {
              font: { family: FONT, size: 10 },
              color: AXIS,
              callback: format
                ? (v) => format(typeof v === "number" ? v : Number(v))
                : undefined,
            },
            grid: { color: GRID },
          },
        },
      },
    };

    chartRef.current = new Chart(canvasRef.current, config);

    return () => { chartRef.current?.destroy(); chartRef.current = null; };
  }, [steps, format]);

  return <ChartFrame height={height}><canvas ref={canvasRef} /></ChartFrame>;
}

// ─── Sparkline (tiny inline SVG line) ────────────────────────────────────────

export function Sparkline({
  data, color = "#6366F1", width = 80, height = 24,
}: {
  data: number[];
  color?: string;
  width?: number;
  height?: number;
}) {
  if (!data.length) return <span style={{ width, height, display: "inline-block" }} />;
  const max   = Math.max(...data, 1);
  const min   = Math.min(...data, 0);
  const range = max - min || 1;
  const stepX = width / Math.max(data.length - 1, 1);
  const pts   = data.map((v, i) =>
    `${i * stepX},${height - ((v - min) / range) * height}`
  ).join(" ");
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

// ─── Heatmap cell (for cohort triangle) ──────────────────────────────────────

export function HeatCell({ value, max = 100 }: { value: number | null; max?: number }) {
  if (value === null) {
    return (
      <div
        className="bg-gray-50 text-gray-300 text-[10px] flex items-center justify-center rounded"
        style={{ height: 32 }}
      >
        —
      </div>
    );
  }
  const ratio = Math.min(1, value / max);
  const bg =
    value === 0  ? "#FEF2F2" :
    value < 10   ? "#FEE2E2" :
    value < 25   ? "#FEF3C7" :
    value < 40   ? "#FDE68A" :
    value < 55   ? "#A7F3D0" :
    value < 70   ? "#6EE7B7" :
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

// ─── Box plot (for score distribution by type) ───────────────────────────────
// Chart.js doesn't ship a box-plot type natively. Hand-roll as SVG.

interface BoxPlotProps {
  rows: {
    label: string;
    min: number;
    q1: number;
    median: number;
    q3: number;
    max: number;
    sample: number;
  }[];
  height?: number;
}

export function BoxPlot({ rows, height = 240 }: BoxPlotProps) {
  if (!rows.length) {
    return <div className="text-xs text-gray-400 py-8 text-center">No data.</div>;
  }
  const scaleMax = 100;
  const scaleMin = 0;
  const rowH     = 36;
  const totalH   = Math.max(height, rows.length * rowH + 40);
  const labelW   = 120;
  const padR     = 50;
  const sx = (v: number) =>
    labelW + ((v - scaleMin) / (scaleMax - scaleMin)) * (600 - labelW - padR);

  return (
    <svg width="100%" viewBox={`0 0 600 ${totalH}`} style={{ display: "block" }}>
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
            <line x1={sx(r.min)} x2={sx(r.max)}  y1={y + 14} y2={y + 14} stroke={AXIS} strokeWidth="1" />
            <line x1={sx(r.min)} x2={sx(r.min)}  y1={y + 6}  y2={y + 22} stroke={AXIS} strokeWidth="1" />
            <line x1={sx(r.max)} x2={sx(r.max)}  y1={y + 6}  y2={y + 22} stroke={AXIS} strokeWidth="1" />
            {/* IQR box */}
            <rect
              x={sx(r.q1)}
              y={y + 4}
              width={sx(r.q3) - sx(r.q1)}
              height={20}
              fill="#6366F1"
              fillOpacity="0.15"
              stroke="#6366F1"
              strokeWidth="1"
              rx="2"
            />
            {/* median */}
            <line
              x1={sx(r.median)} x2={sx(r.median)}
              y1={y + 4} y2={y + 24}
              stroke="#6366F1"
              strokeWidth="2"
            />
          </g>
        );
      })}
    </svg>
  );
}