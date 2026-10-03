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
        <h3 className="text-[13px] font-semibold text-[#ccc] tracking-tight">
          {title}{count !== undefined && <span className="ml-2 text-[12px] font-normal text-[#555] tabular-nums">{count}</span>}
        </h3>
        {action}
      </div>
      <div className="bg-[#0a0a0a] border border-[#141414] rounded-xl overflow-hidden min-w-0">{children}</div>
    </section>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="px-4 py-6 text-center text-[13px] text-[#555]">{children}</div>;
}

export function Stat({ label, value, sub, tone }: { label: string; value: ReactNode; sub?: ReactNode; tone?: string }) {
  return (
    <div className="bg-[#0a0a0a] border border-[#141414] rounded-xl px-4 py-3 min-w-0">
      <div className="text-[11px] font-medium text-[#555] uppercase tracking-wider truncate">{label}</div>
      <div className="text-[20px] font-semibold leading-tight mt-1 tabular-nums truncate text-[#ededed]" style={tone ? { color: tone } : undefined}>{value}</div>
      {sub && <div className="text-[12px] text-[#555] mt-0.5 truncate">{sub}</div>}
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
      <table className="w-full border-collapse text-left">
        <thead>
          <tr className="border-b border-[#141414]">
            {cols.map(c => <th key={c.label} className={`px-4 py-2 text-[11px] font-semibold uppercase tracking-wider text-[#444] whitespace-nowrap ${c.hide ? HIDE[c.hide] : ""}`}>{c.label}</th>)}
          </tr>
        </thead>
        <tbody>
          {shown.map((r, i) => (
            <tr key={rowKey(r, i)} className="border-b border-[#0f0f0f] last:border-0 hover:bg-[#0d0d0d] transition-colors">
              {/* First column holds the (truncating) title; the rest are short values that must not wrap */}
              {cols.map((c, ci) => <td key={c.label} className={`px-4 py-2.5 text-[13px] text-[#999] align-top ${ci > 0 ? "whitespace-nowrap" : ""} ${c.hide ? HIDE[c.hide] : ""} ${c.className ?? ""}`}>{c.cell(r)}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
      {rows.length > limit && (
        <button onClick={() => setAll(v => !v)}
          className="w-full px-4 py-2.5 text-[12px] font-medium text-[#666] hover:text-[#ededed] bg-transparent border-0 border-t border-[#0f0f0f] cursor-pointer transition-colors text-left">
          {all ? "Show less" : `Show all ${rows.length}`}
        </button>
      )}
    </div>
  );
}

// "chrome_extension" → "Chrome extension"
export const human = (s?: string | null) => s ? s.replace(/[-_]+/g, " ").replace(/^\w/, c => c.toUpperCase()) : null;

const PILL: Record<string, string> = {
  // positive
  completed: "#3ecf8e", offer: "#3ecf8e", accepted: "#3ecf8e", resolved: "#3ecf8e", approved: "#3ecf8e", active: "#3ecf8e", delivered: "#3ecf8e",
  // in motion
  "in-progress": "#f5a623", interviewing: "#f5a623", interview: "#f5a623", screening: "#f5a623", pending: "#f5a623", reviewing: "#f5a623", started: "#f5a623",
  applied: "#0070f3", open: "#0070f3",
  // negative
  rejected: "#f55", abandoned: "#f55", denied: "#f55", declined: "#f55", withdrawn: "#888", closed: "#666", dismissed: "#666", revoked: "#666",
};
export function Pill({ status }: { status?: string | null }) {
  const s = (status ?? "—").toLowerCase();
  const c = PILL[s] ?? "#888";
  return (
    <span className="inline-flex items-center gap-1.5 text-[12px] font-medium whitespace-nowrap capitalize" style={{ color: c }}>
      <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: c }} />{s.replace(/[-_]/g, " ")}
    </span>
  );
}

export const Muted = ({ children }: { children: ReactNode }) => <span className="text-[#444]">{children}</span>;
export const dash = <Muted>—</Muted>;
export const Primary = ({ children, sub }: { children: ReactNode; sub?: ReactNode }) => (
  <div className="min-w-0"><div className="text-[13px] text-[#ddd] truncate max-w-[340px]">{children}</div>{sub && <div className="text-[12px] text-[#555] truncate max-w-[340px] mt-0.5">{sub}</div>}</div>
);
