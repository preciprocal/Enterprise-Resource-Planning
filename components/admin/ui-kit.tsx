// components/admin/ui-kit.tsx
// Small, consistent building blocks for the ERP's read-only data pages
// (user page panels in UserInsights.tsx, Marketing in MarketingTab.tsx).
"use client";
import { ReactNode, useState } from "react";

// ─── Primitives ───────────────────────────────────────────────────────────────

export function Block({ title, count, action, children }: { title: string; count?: number | string; action?: ReactNode; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-2.5 min-w-0">
      <div className="flex items-center justify-between gap-3 min-h-7">
        <h3 className="section-title">
          {title}{count !== undefined && <span className="ml-2 text-[12px] font-normal text-fg-4 num">{count}</span>}
        </h3>
        {action}
      </div>
      <div className="card overflow-hidden">{children}</div>
    </section>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="empty">{children}</div>;
}

export function Stat({ label, value, sub, tone }: { label: string; value: ReactNode; sub?: ReactNode; tone?: string }) {
  return (
    <div className="card px-4 py-3.5">
      <div className="label truncate">{label}</div>
      <div className="text-[20px] font-semibold leading-tight mt-1.5 num truncate text-fg tracking-tight" style={tone ? { color: tone } : undefined}>{value}</div>
      {sub && <div className="text-caption mt-0.5 truncate">{sub}</div>}
    </div>
  );
}

export type Col<T> = { label: string; cell: (r: T) => ReactNode; className?: string; hide?: "sm" | "md" | "lg" };
const HIDE = { sm: "hidden sm:table-cell", md: "hidden md:table-cell", lg: "hidden lg:table-cell" } as const;

// Long lists show the first `limit` rows with a "Show all" toggle.
export function Table<T>({ rows, cols, empty, rowKey, limit = 8 }: { rows: T[]; cols: Col<T>[]; empty: string; rowKey: (r: T, i: number) => string; limit?: number }) {
  const [all, setAll] = useState(false);
  if (!rows.length) return <Empty>{empty}</Empty>;
  const shown = all ? rows : rows.slice(0, limit);
  return (
    <div className="overflow-x-auto">
      <table className="data-table">
        <thead>
          <tr>
            {cols.map(c => <th key={c.label} className={c.hide ? HIDE[c.hide] : ""}>{c.label}</th>)}
          </tr>
        </thead>
        <tbody>
          {shown.map((r, i) => (
            <tr key={rowKey(r, i)}>
              {/* First column holds the (truncating) title; the rest are short values that must not wrap */}
              {cols.map((c, ci) => <td key={c.label} className={`text-fg-3! align-top ${ci > 0 ? "whitespace-nowrap" : ""} ${c.hide ? HIDE[c.hide] : ""} ${c.className ?? ""}`}>{c.cell(r)}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
      {rows.length > limit && (
        <button onClick={() => setAll(v => !v)}
          className="w-full px-4 py-2.5 text-[12px] font-medium text-brand-fg hover:text-fg hover:bg-hover bg-transparent border-0 border-t border-line-soft cursor-pointer transition-colors text-left">
          {all ? "Show less" : `Show all ${rows.length}`}
        </button>
      )}
    </div>
  );
}

// "chrome_extension" → "Chrome extension"
export const human = (s?: string | null) => s ? s.replace(/[-_]+/g, " ").replace(/^\w/, c => c.toUpperCase()) : null;

type Tone = "success" | "warning" | "brand" | "danger" | "neutral";
const PILL: Record<string, Tone> = {
  // positive
  completed: "success", offer: "success", accepted: "success", resolved: "success", approved: "success", active: "success", delivered: "success",
  // in motion
  "in-progress": "warning", interviewing: "warning", interview: "warning", screening: "warning", pending: "warning", reviewing: "warning", started: "warning",
  applied: "brand", open: "brand",
  // negative
  rejected: "danger", abandoned: "danger", denied: "danger", declined: "danger", withdrawn: "neutral", closed: "neutral", dismissed: "neutral", revoked: "neutral",
};
const DOT: Record<Tone, string> = { success: "bg-success", warning: "bg-warning", brand: "bg-brand", danger: "bg-danger", neutral: "bg-fg-4" };
export function Pill({ status }: { status?: string | null }) {
  const s = (status ?? "—").toLowerCase();
  const t = PILL[s] ?? "neutral";
  return (
    <span className={`badge badge-${t} capitalize`}>
      <span className={`dot ${DOT[t]}`} />{s.replace(/[-_]/g, " ")}
    </span>
  );
}

export const Muted = ({ children }: { children: ReactNode }) => <span className="text-fg-5">{children}</span>;
export const dash = <Muted>—</Muted>;
export const Primary = ({ children, sub }: { children: ReactNode; sub?: ReactNode }) => (
  <div className="min-w-0"><div className="text-[13px] text-fg-2 truncate max-w-[340px]">{children}</div>{sub && <div className="text-[12px] text-fg-4 truncate max-w-[340px] mt-0.5">{sub}</div>}</div>
);
