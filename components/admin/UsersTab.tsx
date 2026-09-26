// components/admin/UsersTab.tsx
"use client";

import { useState, useEffect, ReactNode } from "react";
import {
  User, AnalyticsData, PLANS, USAGE_FIELDS, LIMITS,
  planColor, statusColor, fmtFull, daysAgo,
  Avatar, Chip, CodeRef, Spinner, HBar, StatusDot, StudentChip,
  inputCls, Select, useIsMobile, Card, CardTitle, FRow, SkeletonTable,
} from "./admin-shared";
import { StripeCoupon, PlanEditorPanel, CouponPanel, ContactPanel } from "./StripeTab";
import { FEATURE_LABELS } from "@/lib/packs";

// student_verifications.verification_method values written by the Dashboard
const STUDENT_METHOD_LABELS: Record<string, string> = {
  email_otp:      "Email code",
  legacy_import:  "Imported (Firebase)",
  legacy_coupon:  "Student coupon (legacy)",
};

// ── Props ─────────────────────────────────────────────────────────────────────

interface Props {
  users: User[]; filtered: User[]; loading: boolean; analytics: AnalyticsData | null;
  search: string; setSearch: (v: string) => void;
  planF: string; setPlanF: (v: string) => void;
  sortF: string; setSortF: (v: string) => void;
  sortD: "asc" | "desc"; setSortD: (fn: (d: "asc" | "desc") => "asc" | "desc") => void;
  saveUser: (user: User) => Promise<void>; saving: boolean; msg: string;
  token?: string;
}

// ── Sort icon ─────────────────────────────────────────────────────────────────

function SortChevrons({ active, dir }: { active: boolean; dir: "asc" | "desc" }) {
  return (
    <span className="inline-flex flex-col gap-[1px] ml-1 shrink-0">
      <svg width="8" height="5" viewBox="0 0 8 5" fill="none">
        <path d="M4 0L7.5 5H0.5L4 0Z" fill={active && dir === "asc" ? "#aaa" : "#2a2a2a"} />
      </svg>
      <svg width="8" height="5" viewBox="0 0 8 5" fill="none">
        <path d="M4 5L0.5 0H7.5L4 5Z" fill={active && dir === "desc" ? "#aaa" : "#2a2a2a"} />
      </svg>
    </span>
  );
}

// ── UsersTab ──────────────────────────────────────────────────────────────────

export default function UsersTab({
  users, filtered, loading, search, setSearch, planF, setPlanF,
  sortF, setSortF, sortD, setSortD, saveUser, saving, msg, token = "",
}: Props) {
  const [selectedUser, setSelectedUser] = useState<User | null>(null);
  const isMobile = useIsMobile();

  const sortableColumns = [
    { key: "name",      label: "User"   },
    { key: "plan",      label: "Plan"   },
    { key: "status",    label: "Status" },
    { key: "stripe",    label: "Stripe" },
    { key: "createdAt", label: "Joined" },
  ] as const;

  function handleSort(key: string, sortable: boolean) {
    if (!sortable) return;
    setSortF(key);
    setSortD(d => key === sortF ? (d === "asc" ? "desc" : "asc") : "asc");
  }

  if (selectedUser) {
    return (
      <UserDetail
        user={selectedUser}
        onClose={() => setSelectedUser(null)}
        onUserUpdate={u => setSelectedUser(u)}
        saveUser={saveUser}
        saving={saving}
        msg={msg}
        token={token}
      />
    );
  }

  return (
    <div className="flex-1 flex flex-col overflow-hidden min-w-0">

      {/* ── Toolbar ── */}
      <div className="px-5 py-3 border-b border-[#141414] flex items-center gap-3 bg-black shrink-0">
        {/* Search */}
        <div className="relative flex-1 max-w-[340px]">
          <svg className="absolute left-3 top-1/2 -translate-y-1/2 text-[#3a3a3a] pointer-events-none shrink-0" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
            <circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/>
          </svg>
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search name, email, UID…"
            className="w-full border border-[#1a1a1a] rounded-lg px-3 py-2 pl-9 text-[14px] text-[#ededed] bg-[#080808] outline-none focus:border-[#2d2d2d] transition-colors placeholder:text-[#333] font-[inherit]"
          />
          {search && (
            <button
              onClick={() => setSearch("")}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-[#3a3a3a] hover:text-[#777] transition-colors cursor-pointer border-none bg-transparent p-0"
            >
              <svg width="11" height="11" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24"><path d="M18 6L6 18M6 6l12 12"/></svg>
            </button>
          )}
        </div>

        {/* Plan filter */}
        <Select
          value={planF}
          onChange={e => setPlanF(e.target.value)}
          wrapperClassName="min-w-[120px]"
        >
          <option value="all">All plans</option>
          {PLANS.map(p => (
            <option key={p} value={p}>{p.charAt(0).toUpperCase() + p.slice(1)}</option>
          ))}
          <optgroup label="Students (.edu)">
            <option value="student">All students</option>
            <option value="student:claimed">Claimed free month</option>
            <option value="student:verified">Verified, not claimed</option>
            <option value="student:pending">Pending verification</option>
          </optgroup>
        </Select>

        {/* Row count */}
        <div className="ml-auto flex items-baseline gap-1.5 shrink-0">
          <span className="text-[14px] font-bold text-[#e0e0e0] tabular-nums">{filtered.length.toLocaleString()}</span>
          <span className="text-[13px] text-[#3a3a3a]">
            {filtered.length !== users.length ? `of ${users.length.toLocaleString()} ` : ""}
            {filtered.length === 1 ? "user" : "users"}
          </span>
        </div>
      </div>

      {/* ── List ── */}
      <div className="flex-1 overflow-auto bg-black">
        {loading ? (
          <SkeletonTable rows={8} cols={5} />
        ) : isMobile ? (
          /* Mobile cards */
          <div className="flex flex-col divide-y divide-[#0d0d0d]">
            {filtered.map(u => {
              const p = planColor(u.subscription?.plan);
              const s = statusColor(u.subscription?.status);
              return (
                <div
                  key={u.id}
                  onClick={() => setSelectedUser(u)}
                  className="px-4 py-4 cursor-pointer bg-black hover:bg-[#070707] active:bg-[#0d0d0d] transition-colors"
                >
                  <div className="flex items-start gap-3">
                    <div className="w-0.5 self-stretch rounded-full shrink-0" style={{ background: p.accent }} />
                    <Avatar name={u.name} size={40} />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-baseline justify-between gap-2">
                        <span className="font-semibold text-[14px] text-[#e0e0e0] truncate">{u.name ?? "Unknown"}</span>
                        <span className="text-[12px] text-[#3a3a3a] shrink-0">{daysAgo(u.createdAt)}</span>
                      </div>
                      <div className="text-[13px] text-[#555] truncate mt-0.5">{u.email}</div>
                      <div className="flex items-center gap-2 mt-2 flex-wrap">
                        <Chip label={u.subscription?.plan ?? "free"} className={`border text-[12px] font-semibold ${p.tw}`} />
                        {u.subscription?.status && (
                          <div className="flex items-center gap-1.5">
                            <StatusDot color={s.dot} />
                            <span className="text-[12px] font-medium" style={{ color: s.text }}>{u.subscription.status}</span>
                          </div>
                        )}
                        {u.subscription?.stripeCustomerId && (
                          <Chip label="Stripe" className="bg-[rgba(62,207,142,0.08)] text-[#3ecf8e] border border-[rgba(62,207,142,0.15)] text-[12px] font-medium" />
                        )}
                        <StudentChip student={u.student} />
                      </div>
                    </div>
                    <svg className="text-[#222] shrink-0 mt-1" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                      <path d="M9 18l6-6-6-6"/>
                    </svg>
                  </div>
                </div>
              );
            })}
            {!filtered.length && <EmptyState search={search} />}
          </div>
        ) : (
          /* Desktop table */
          <table className="w-full border-collapse" style={{ tableLayout: "fixed" }}>
            <colgroup>
              <col style={{ width: "37%" }} />
              <col style={{ width: "13%" }} />
              <col style={{ width: "15%" }} />
              <col style={{ width: "14%" }} />
              <col style={{ width: "21%" }} />
            </colgroup>
            <thead className="sticky top-0 z-10">
              <tr className="bg-[#050505] border-b border-[#141414]">
                {sortableColumns.map(({ key, label }) => {
                  const sortable = ["name", "plan", "createdAt"].includes(key);
                  const active = sortF === key;
                  return (
                    <th key={key} className="px-4 py-3 text-left select-none">
                      {sortable ? (
                        <button
                          onClick={() => handleSort(key, sortable)}
                          className="inline-flex items-center gap-0.5 cursor-pointer border-none bg-transparent p-0 transition-colors hover:text-[#777] group"
                          style={{ fontFamily: "inherit" }}
                        >
                          <span className={`text-[12px] font-semibold tracking-widest uppercase ${active ? "text-[#777]" : "text-[#333]"}`}>{label}</span>
                          <SortChevrons active={active} dir={sortD} />
                        </button>
                      ) : (
                        <span className="text-[12px] font-semibold tracking-widest uppercase text-[#333]">{label}</span>
                      )}
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {filtered.map(u => {
                const p = planColor(u.subscription?.plan);
                const s = statusColor(u.subscription?.status);
                return (
                  <tr
                    key={u.id}
                    onClick={() => setSelectedUser(u)}
                    className="border-b border-[#0a0a0a] cursor-pointer transition-colors bg-black hover:bg-[#070707] group"
                  >
                    {/* User */}
                    <td className="px-4 py-3.5">
                      <div className="flex items-center gap-3">
                        <div
                          className="w-0.5 h-9 rounded-full shrink-0 transition-opacity opacity-50 group-hover:opacity-100"
                          style={{ background: p.accent }}
                        />
                        <Avatar name={u.name} size={36} />
                        <div className="min-w-0">
                          <div className="flex items-center gap-2 min-w-0">
                            <span className="text-[14px] font-semibold text-[#e0e0e0] truncate leading-tight">{u.name ?? "Unknown"}</span>
                            <StudentChip student={u.student} compact className="shrink-0" />
                          </div>
                          <div className="text-[13px] text-[#555] truncate mt-0.5">{u.email}</div>
                        </div>
                      </div>
                    </td>
                    {/* Plan */}
                    <td className="px-4 py-3.5">
                      <Chip
                        label={(u.subscription?.plan ?? "free").charAt(0).toUpperCase() + (u.subscription?.plan ?? "free").slice(1)}
                        className={`border text-[12px] font-semibold ${p.tw}`}
                      />
                    </td>
                    {/* Status */}
                    <td className="px-4 py-3.5">
                      {u.subscription?.status ? (
                        <div className="flex items-center gap-2">
                          <StatusDot color={s.dot} />
                          <span className="text-[13px] font-medium" style={{ color: s.text }}>{u.subscription.status}</span>
                        </div>
                      ) : (
                        <span className="text-[14px] text-[#222]">—</span>
                      )}
                    </td>
                    {/* Stripe */}
                    <td className="px-4 py-3.5">
                      {u.subscription?.stripeCustomerId ? (
                        <div className="flex items-center gap-1.5">
                          <svg width="11" height="11" fill="none" stroke="#3ecf8e" strokeWidth="2.5" viewBox="0 0 24 24">
                            <polyline points="20 6 9 17 4 12"/>
                          </svg>
                          <span className="text-[13px] font-medium text-[#3ecf8e]">Connected</span>
                        </div>
                      ) : (
                        <span className="text-[14px] text-[#222]">—</span>
                      )}
                    </td>
                    {/* Joined */}
                    <td className="px-4 py-3.5">
                      <span className="text-[13px] font-medium text-[#555]">{daysAgo(u.createdAt)}</span>
                    </td>
                  </tr>
                );
              })}
              {!filtered.length && (
                <tr><td colSpan={5}><EmptyState search={search} /></td></tr>
              )}
            </tbody>
          </table>
        )}
      </div>

    </div>
  );
}

// ── EmptyState ────────────────────────────────────────────────────────────────

function EmptyState({ search }: { search: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-24 gap-4 text-center px-6">
      <div className="w-14 h-14 rounded-2xl bg-[#0a0a0a] border border-[#141414] flex items-center justify-center">
        <svg width="22" height="22" fill="none" stroke="#2a2a2a" strokeWidth="1.5" viewBox="0 0 24 24">
          <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/>
          <circle cx="9" cy="7" r="4"/>
          <path d="M23 21v-2a4 4 0 0 0-3-3.87"/>
          <path d="M16 3.13a4 4 0 0 1 0 7.75"/>
        </svg>
      </div>
      <div className="flex flex-col gap-1">
        <span className="text-[14px] font-semibold text-[#444]">No users found</span>
        {search && <span className="text-[13px] text-[#2a2a2a]">No results for &ldquo;{search}&rdquo;</span>}
      </div>
    </div>
  );
}

// ── UserDetail ────────────────────────────────────────────────────────────────

const DETAIL_TABS = [
  {
    id: "profile",
    label: "Profile",
    icon: (
      <svg width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
        <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/>
        <circle cx="12" cy="7" r="4"/>
      </svg>
    ),
  },
  {
    id: "subscription",
    label: "Subscription",
    icon: (
      <svg width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
        <path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"/>
        <line x1="7" y1="7" x2="7.01" y2="7"/>
      </svg>
    ),
  },
  {
    id: "usage",
    label: "Usage",
    icon: (
      <svg width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
        <path d="M18 20V10M12 20V4M6 20v-6"/>
      </svg>
    ),
  },
  {
    id: "contact",
    label: "Contact",
    icon: (
      <svg width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
        <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/>
        <polyline points="22,6 12,13 2,6"/>
      </svg>
    ),
  },
  {
    id: "raw",
    label: "Raw",
    icon: (
      <svg width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
        <polyline points="16 18 22 12 16 6"/>
        <polyline points="8 6 2 12 8 18"/>
      </svg>
    ),
  },
] as const;

type DetailTab = typeof DETAIL_TABS[number]["id"];

function UserDetail({
  user: initialUser, onClose, onUserUpdate, saveUser, saving, msg, token = "",
}: {
  user: User; onClose: () => void; onUserUpdate?: (u: User) => void;
  saveUser: (u: User) => Promise<void>; saving: boolean; msg: string; token?: string;
}) {
  const isMobile = useIsMobile();
  const [user, setUser] = useState<User>(initialUser);
  const [edit, setEdit] = useState<User>(JSON.parse(JSON.stringify(initialUser)));
  const [tab, setTab]   = useState<DetailTab>("profile");
  const [coupons, setCoupons]           = useState<StripeCoupon[]>([]);
  const [loadingCoupons, setLoadingCoupons] = useState(true);
  const [couponMsg, setCouponMsg]       = useState("");
  const pc = planColor(user.subscription?.plan);
  const sc = statusColor(user.subscription?.status);
  const totalUsage = USAGE_FIELDS.reduce((s, { key }) => s + ((user.usage?.[key] as number) ?? 0), 0);
  const isEditableTab = tab !== "raw" && tab !== "contact";

  useEffect(() => {
    setLoadingCoupons(true);
    (async () => {
      try {
        const res  = await fetch("/api/admin?action=coupons", { headers: token ? { "x-admin-token": token } : {} });
        const json = await res.json() as { coupons?: StripeCoupon[]; error?: string };
        if (res.ok && json.coupons) setCoupons(json.coupons);
      } catch {}
      setLoadingCoupons(false);
    })();
  }, [token]);

  function handleSave()    { void saveUser(edit); }
  function handleDiscard() { setEdit(JSON.parse(JSON.stringify(user))); }

  // ── Sidebar ──

  const Sidebar = (
    <div className="w-1/3 shrink-0 border-r border-[#141414] flex flex-col bg-[#050505] overflow-y-auto">

      {/* Accent bar */}
      <div className="h-[2px] shrink-0" style={{ background: `linear-gradient(90deg, ${pc.accent} 0%, transparent 70%)` }} />

      {/* Back + label */}
      <div className="flex items-center gap-2.5 px-4 h-12 border-b border-[#0f0f0f] shrink-0">
        <button
          onClick={onClose}
          className="flex items-center gap-1.5 text-[#444] hover:text-[#ededed] transition-colors cursor-pointer border-none bg-transparent p-0"
          style={{ fontFamily: "inherit" }}
        >
          <svg width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
            <path d="M15 18l-6-6 6-6"/>
          </svg>
          <span className="text-[13px] font-medium">All users</span>
        </button>
      </div>

      {/* Identity */}
      <div className="px-5 py-6 flex flex-col items-center text-center gap-4 border-b border-[#0f0f0f]">
        <div className="relative">
          <Avatar name={user.name} size={72} />
          {user.isAdmin && (
            <div className="absolute -bottom-1 -right-1 w-5 h-5 rounded-full bg-[#f5a623] flex items-center justify-center ring-2 ring-[#050505]" title="Admin">
              <svg width="8" height="8" fill="white" viewBox="0 0 24 24">
                <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/>
              </svg>
            </div>
          )}
        </div>
        <div className="w-full">
          <div className="text-[15px] font-semibold text-[#ededed] leading-snug">{user.name ?? "Unknown"}</div>
          <div className="text-[13px] text-[#555] mt-1 break-all">{user.email}</div>
        </div>
        <div className="flex items-center gap-1.5 flex-wrap justify-center">
          <Chip
            label={(user.subscription?.plan ?? "free").charAt(0).toUpperCase() + (user.subscription?.plan ?? "free").slice(1)}
            className={`border text-[12px] font-semibold ${pc.tw}`}
          />
          {user.subscription?.status && (
            <div className="flex items-center gap-1.5">
              <StatusDot color={sc.dot} />
              <span className="text-[12px] font-medium" style={{ color: sc.text }}>{user.subscription.status}</span>
            </div>
          )}
          {user.subscription?.stripeCustomerId && (
            <Chip label="Stripe" className="bg-[rgba(62,207,142,0.08)] text-[#3ecf8e] border border-[rgba(62,207,142,0.15)] text-[12px] font-medium" />
          )}
          {user.isAdmin && (
            <Chip label="Admin" className="bg-[rgba(245,166,35,0.08)] text-[#f5a623] border border-[rgba(245,166,35,0.2)] text-[12px] font-medium" />
          )}
          <StudentChip student={user.student} />
        </div>
      </div>

      {/* Stat cards */}
      <div className="px-4 py-4 grid grid-cols-2 gap-2 border-b border-[#0f0f0f]">
        {[
          { label: "Joined",      value: daysAgo(user.createdAt) },
          { label: "Last active", value: daysAgo(user.lastLogin ?? user.updatedAt) },
          { label: "Provider",    value: user.provider ?? "email" },
          { label: "Total uses",  value: String(totalUsage) },
        ].map(({ label, value }) => (
          <div key={label} className="bg-[#0a0a0a] border border-[#141414] rounded-lg px-3 py-2.5">
            <div className="text-[11px] font-semibold text-[#2a2a2a] uppercase tracking-wider mb-1">{label}</div>
            <div className="text-[13px] font-semibold text-[#bbb] capitalize truncate">{value || <span className="text-[#222]">—</span>}</div>
          </div>
        ))}
      </div>

      {/* Subscription summary */}
      <div className="px-4 py-4 border-b border-[#0f0f0f]">
        <div className="text-[11px] font-semibold text-[#2a2a2a] uppercase tracking-wider mb-2.5">Subscription</div>
        <div className="bg-[#0a0a0a] border border-[#141414] rounded-lg overflow-hidden divide-y divide-[#141414]">
          {[
            { label: "Plan",       value: (user.subscription?.plan ?? "free").charAt(0).toUpperCase() + (user.subscription?.plan ?? "free").slice(1) },
            { label: "Status",     value: user.subscription?.status ?? "—" },
            { label: "Period end", value: fmtFull(user.subscription?.currentPeriodEnd) || "—" },
            { label: "Interviews", value: `${user.usage?.interviewsUsed ?? 0} / ${(LIMITS[user.subscription?.plan ?? "free"]?.interviewsUsed ?? 0) < 0 ? "∞" : (LIMITS[user.subscription?.plan ?? "free"]?.interviewsUsed ?? 0)}` },
            { label: "Pack credits", value: user.packs?.totalCredits ? String(user.packs.totalCredits) : "—" },
          ].map(({ label, value }) => (
            <div key={label} className="flex items-center justify-between px-3 py-2">
              <span className="text-[11px] font-semibold text-[#333] uppercase tracking-wide">{label}</span>
              <span className="text-[12px] font-medium text-[#aaa] truncate max-w-[60%] text-right">{value}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Stripe IDs */}
      {(user.subscription?.stripeCustomerId || user.subscription?.stripeSubscriptionId) && (
        <div className="px-4 py-4 border-b border-[#0f0f0f]">
          <div className="text-[11px] font-semibold text-[#2a2a2a] uppercase tracking-wider mb-2.5">Stripe</div>
          <div className="bg-[#0a0a0a] border border-[#141414] rounded-lg overflow-hidden divide-y divide-[#141414]">
            {[["cus", user.subscription.stripeCustomerId], ["sub", user.subscription.stripeSubscriptionId]]
              .filter(([, v]) => v)
              .map(([prefix, val]) => (
                <div key={prefix} className="flex items-center gap-2.5 px-3 py-2.5">
                  <span className="text-[11px] font-bold text-[#333] uppercase w-5 shrink-0">{prefix}</span>
                  <code className="font-mono text-[11px] text-[#0070f3] truncate flex-1">{val}</code>
                  <button
                    onClick={() => navigator.clipboard?.writeText(val as string)}
                    className="text-[12px] font-medium text-[#333] hover:text-[#777] cursor-pointer border-none bg-transparent transition-colors shrink-0"
                  >
                    copy
                  </button>
                </div>
              ))}
          </div>
        </div>
      )}

      {/* UID */}
      <div className="px-4 py-4">
        <div className="text-[11px] font-semibold text-[#2a2a2a] uppercase tracking-wider mb-2">User ID</div>
        <div className="flex items-center gap-2 bg-[#0a0a0a] border border-[#141414] rounded-lg px-3 py-2">
          <code className="font-mono text-[11px] text-[#2a2a2a] tracking-wide truncate flex-1">{user.id}</code>
          <button
            onClick={() => navigator.clipboard?.writeText(user.id)}
            className="text-[12px] font-medium text-[#333] hover:text-[#777] cursor-pointer border-none bg-transparent transition-colors shrink-0"
          >
            copy
          </button>
        </div>
      </div>
    </div>
  );

  // ── Content ──

  const Content = (
    <div className="flex-1 flex flex-col min-w-0 overflow-hidden">

      {/* Mobile header */}
      {isMobile && (
        <div className="flex items-center gap-3 px-4 h-12 border-b border-[#141414] shrink-0 bg-black">
          <button
            onClick={onClose}
            className="flex items-center gap-1.5 text-[#444] hover:text-[#ededed] transition-colors cursor-pointer border-none bg-transparent p-0"
            style={{ fontFamily: "inherit" }}
          >
            <svg width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
              <path d="M15 18l-6-6 6-6"/>
            </svg>
            <span className="text-[13px] font-medium">All users</span>
          </button>
          <div className="w-px h-4 bg-[#1a1a1a] mx-1" />
          <span className="text-[13px] font-semibold text-[#ededed] truncate">{user.name ?? "Unknown"}</span>
        </div>
      )}

      {/* Tab bar + actions */}
      <div className="flex items-center px-5 border-b border-[#141414] h-12 shrink-0 bg-black gap-1">
        {DETAIL_TABS.map(t => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`flex items-center gap-1.5 px-3 h-8 rounded-md text-[13px] font-medium transition-all cursor-pointer border-none whitespace-nowrap ${
              tab === t.id
                ? "bg-[#111] text-[#e0e0e0]"
                : "bg-transparent text-[#444] hover:text-[#777] hover:bg-[#080808]"
            }`}
            style={{ fontFamily: "inherit" }}
          >
            <span className={`transition-colors ${tab === t.id ? "text-[#777]" : "text-[#2a2a2a]"}`}>{t.icon}</span>
            {t.label}
          </button>
        ))}

        {isEditableTab && (
          <div className="ml-auto flex items-center gap-2.5 shrink-0">
            {msg && (
              <span className={`text-[13px] font-medium ${msg.startsWith("✓") ? "text-[#3ecf8e]" : "text-[#f55]"}`}>
                {msg}
              </span>
            )}
            <button
              onClick={handleDiscard}
              className="h-8 px-3.5 rounded-md border border-[#1a1a1a] bg-transparent text-[13px] font-medium text-[#444] cursor-pointer hover:text-[#888] hover:border-[#2a2a2a] transition-all"
              style={{ fontFamily: "inherit" }}
            >
              Discard
            </button>
            <button
              onClick={handleSave}
              disabled={saving}
              className={`h-8 px-4 rounded-md text-[13px] font-semibold border-none cursor-pointer transition-colors ${
                saving ? "bg-[#141414] text-[#444]" : "bg-[#ededed] text-black hover:bg-white"
              }`}
              style={{ fontFamily: "inherit" }}
            >
              {saving ? "Saving…" : "Save changes"}
            </button>
          </div>
        )}
      </div>

      {/* Content area */}
      <div className="flex-1 overflow-auto">
        <div className="p-6 md:p-8 flex flex-col gap-7 w-full">

          {/* ── Profile ── */}
          {tab === "profile" && (
            <>
              <Section title="Identity">
                <FormCard>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
                    <FormField label="Display name">
                      <input
                        value={String(edit.name ?? "")}
                        onChange={e => setEdit(p => ({ ...p, name: e.target.value }))}
                        className={inputCls}
                      />
                    </FormField>
                    <FormField label="Email address">
                      <div className="relative">
                        <input
                          value={String(edit.email ?? "")}
                          onChange={e => setEdit(p => ({ ...p, email: e.target.value }))}
                          className={`${inputCls} pr-14`}
                        />
                        <button
                          onClick={() => navigator.clipboard?.writeText(String(edit.email ?? ""))}
                          className="absolute right-3 top-1/2 -translate-y-1/2 text-[12px] font-medium text-[#444] hover:text-[#888] border-none bg-transparent cursor-pointer transition-colors"
                        >
                          Copy
                        </button>
                      </div>
                    </FormField>
                    <FormField label="Admin access">
                      <Select
                        value={String(edit.isAdmin ?? false)}
                        onChange={e => setEdit(p => ({ ...p, isAdmin: e.target.value === "true" }))}
                      >
                        <option value="false">No</option>
                        <option value="true">Yes</option>
                      </Select>
                    </FormField>
                    <FormField label="Auth provider">
                      <div className={`${inputCls} text-[#555] cursor-default capitalize select-none`}>{user.provider ?? "email"}</div>
                    </FormField>
                  </div>
                </FormCard>
              </Section>

              <Section title="Timestamps">
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  {[
                    { label: "Created",    value: fmtFull(user.createdAt) },
                    { label: "Updated",    value: fmtFull(user.updatedAt) },
                    { label: "Last login", value: fmtFull(user.lastLogin) },
                    { label: "User ID",    value: user.id, mono: true },
                  ].map(({ label, value, mono }) => (
                    <div key={label} className="bg-[#070707] border border-[#0f0f0f] rounded-xl px-4 py-3">
                      <div className="text-[11px] font-bold text-[#2a2a2a] uppercase tracking-wider mb-1.5">{label}</div>
                      <div className={`truncate font-medium ${mono ? "font-mono text-[#0070f3] text-[11px]" : "text-[13px] text-[#ccc]"}`}>
                        {value || <span className="text-[#1e1e1e]">—</span>}
                      </div>
                      {label === "User ID" && value && (
                        <button
                          onClick={() => navigator.clipboard?.writeText(value)}
                          className="mt-1 text-[11px] font-medium text-[#2a2a2a] hover:text-[#666] cursor-pointer border-none bg-transparent transition-colors"
                        >
                          copy
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              </Section>
            </>
          )}

          {/* ── Subscription ── */}
          {tab === "subscription" && (
            <>
              {/* Editable subscription settings */}
              <Section title="Subscription settings" action={<CodeRef k="subscriptionFields" />}>
                <FormCard>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
                    <FormField label="Plan">
                      <Select
                        value={String(edit.subscription?.plan ?? "")}
                        onChange={e => setEdit(p => ({ ...p, subscription: { ...p.subscription, plan: e.target.value } }))}
                      >
                        {PLANS.map(o => (
                          <option key={o} value={o}>{o.charAt(0).toUpperCase() + o.slice(1)}</option>
                        ))}
                      </Select>
                    </FormField>
                    <FormField label="Status">
                      <Select
                        value={String(edit.subscription?.status ?? "")}
                        onChange={e => setEdit(p => ({ ...p, subscription: { ...p.subscription, status: e.target.value } }))}
                      >
                        {["active", "canceled", "past_due", "trialing"].map(o => (
                          <option key={o} value={o}>{o}</option>
                        ))}
                      </Select>
                    </FormField>
                    <FormField label="Student verified">
                      <Select
                        value={String(edit.subscription?.studentVerified ?? false)}
                        onChange={e => setEdit(p => ({ ...p, subscription: { ...p.subscription, studentVerified: e.target.value === "true" } }))}
                      >
                        <option value="false">No</option>
                        <option value="true">Yes</option>
                      </Select>
                    </FormField>
                  </div>
                </FormCard>
              </Section>

              {/* Change plan, dates & apply coupon */}
              <Card>
                <CardTitle>Change Plan & Dates</CardTitle>
                <PlanEditorPanel
                  user={user} isMobile={isMobile} token={token}
                  coupons={coupons} loadingCoupons={loadingCoupons}
                  onSaved={u => { setUser(u); onUserUpdate?.(u); }}
                />
              </Card>

              {/* Apply coupon manually */}
              <Card>
                <CardTitle>Apply Coupon</CardTitle>
                {couponMsg && (
                  <div className={`mb-3 px-3 py-2 rounded-lg text-[12px] font-medium ${couponMsg.startsWith("✗") ? "bg-[rgba(255,68,68,0.06)] border border-[rgba(255,68,68,0.2)] text-[#f55]" : "bg-[rgba(62,207,142,0.06)] border border-[rgba(62,207,142,0.2)] text-[#3ecf8e]"}`}>
                    {couponMsg}
                  </div>
                )}
                <CouponPanel
                  user={user} token={token}
                  coupons={coupons} loadingCoupons={loadingCoupons}
                  onDone={(m: string) => {
                    setCouponMsg(`✓ ${m}`);
                    setTimeout(() => setCouponMsg(""), 4000);
                    setUser(u => ({ ...u, subscription: { ...u.subscription, lastAppliedCoupon: m.replace(/^Coupon "(.+)" applied$/, "$1") } }));
                    onUserUpdate?.({ ...user, subscription: { ...user.subscription, lastAppliedCoupon: m.replace(/^Coupon "(.+)" applied$/, "$1") } });
                  }}
                />
              </Card>

              {/* Read-only subscription details */}
              <Card>
                <CardTitle>Subscription Details</CardTitle>
                <FRow label="Plan"         badgeLabel={user.subscription?.plan ?? "free"} badgeClassName={`border font-bold ${planColor(user.subscription?.plan).tw}`} />
                <FRow label="Status"       badgeLabel={user.subscription?.status ?? ""} badgeClassName="text-[13px] font-semibold" />
                <FRow label="Customer ID"  value={user.subscription?.stripeCustomerId} mono copyable />
                <FRow label="Sub ID"       value={user.subscription?.stripeSubscriptionId} mono copyable />
                <FRow label="Period Start" value={fmtFull(user.subscription?.currentPeriodStart)} />
                <FRow label="Period End"   value={fmtFull(user.subscription?.currentPeriodEnd)} />
                <FRow label="Started"      value={fmtFull(user.subscription?.subscriptionStartedAt)} />
                <FRow label="Last Payment" value={fmtFull(user.subscription?.lastPaymentAt)} />
                <FRow label="Canceled At"  value={fmtFull(user.subscription?.canceledAt)} />
                <FRow label="Trial Ends"   value={fmtFull(user.subscription?.trialEndsAt)} />
                <FRow label="Last Coupon"  value={user.subscription?.lastAppliedCoupon} />
                <FRow label="Edu Email"    value={user.subscription?.studentEduEmail} />
              </Card>

              {/* Credit packs (credit_packs ledger) */}
              <Card>
                <CardTitle>Credit Packs</CardTitle>
                <FRow label="Purchased"   value={user.packs?.purchases ? `${user.packs.purchases}${user.packs.refunded ? ` (${user.packs.refunded} refunded)` : ""}` : "None"} />
                <FRow label="Spent"       value={user.packs?.spentCents ? `$${(user.packs.spentCents / 100).toFixed(2)}` : ""} />
                <FRow label="Last bought" value={fmtFull(user.packs?.lastPurchasedAt)} />
                {Object.entries(user.packs?.balance ?? {}).filter(([, v]) => v > 0).map(([k, v]) => (
                  <FRow key={k} label={FEATURE_LABELS[k] ?? k} value={`${v} credit${v === 1 ? "" : "s"} left`} />
                ))}
              </Card>

              {/* .edu student perk (student_verifications) */}
              <Card>
                <div className="flex items-center justify-between gap-2 mb-4 flex-wrap">
                  <CardTitle>Student (.edu)</CardTitle>
                  <StudentChip student={user.student} />
                </div>
                {user.student ? (
                  <>
                    <FRow label="Status" value={
                      user.student.status === "claimed"  ? "Verified and claimed the free student month" :
                      user.student.status === "verified" ? "Verified — free month not claimed" :
                                                           "Started verification, never entered the code"} />
                    <FRow label="Edu email"   value={user.student.eduEmail} copyable />
                    <FRow label="School"      value={user.student.domain} />
                    <FRow label="Method"      value={STUDENT_METHOD_LABELS[user.student.method ?? ""] ?? user.student.method} />
                    {/* For imported accounts this is the migration date, not when they verified */}
                    <FRow label={user.student.method === "email_otp" ? "Started" : "Record created"} value={fmtFull(user.student.startedAt)} />
                    <FRow label="Verified"    value={fmtFull(user.student.verifiedAt)} />
                    <FRow label="Claimed"     value={fmtFull(user.student.claimedAt)} />
                    {user.student.status === "claimed" && (
                      <FRow label="Trial ends" value={fmtFull(user.subscription?.trialEndsAt)} />
                    )}
                    {user.student.status === "pending" && (user.student.attempts ?? 0) > 0 && (
                      <FRow label="Code attempts" value={user.student.attempts} />
                    )}
                  </>
                ) : (
                  <div className="text-[13px] text-[#555]">Hasn&apos;t verified a student email.</div>
                )}
              </Card>
            </>
          )}

          {/* ── Usage ── */}
          {tab === "usage" && (
            <Section
              title={<>Feature counters <CodeRef k="usagePeriod" /></>}
              action={
                <button
                  onClick={() => setEdit(p => ({
                    ...p,
                    usage: {
                      ...p.usage,
                      ...Object.fromEntries(USAGE_FIELDS.map(f => [f.key, 0])),
                      lastReset: new Date().toISOString(),
                    },
                  }))}
                  className="px-3 py-1.5 rounded-md bg-[rgba(62,207,142,0.06)] border border-[rgba(62,207,142,0.15)] text-[#3ecf8e] text-[13px] font-medium cursor-pointer hover:bg-[rgba(62,207,142,0.1)] transition-colors"
                >
                  Reset all
                </button>
              }
            >
              <div className="bg-[#070707] border border-[#0f0f0f] rounded-xl overflow-hidden divide-y divide-[#0d0d0d]">
                {USAGE_FIELDS.map(({ key, label, color }) => {
                  const val  = (edit.usage?.[key] as number) ?? 0;
                  const plan = edit.subscription?.plan ?? "free";
                  const lim  = LIMITS[plan]?.[key as string] ?? 0;
                  const inf  = lim === -1;
                  const pct  = inf ? 15 : lim > 0 ? Math.min(100, Math.round((val / lim) * 100)) : 0;
                  const over = !inf && val >= lim && lim > 0;
                  return (
                    <div key={key as string} className="flex items-center gap-4 px-4 py-3.5">
                      <div className="w-2 h-2 rounded-full shrink-0" style={{ background: color }} />
                      <span className="text-[14px] text-[#ccc] font-medium w-32 shrink-0">{label}</span>
                      <HBar pct={pct} color={over ? "#f55" : color} />
                      <input
                        type="number"
                        min={0}
                        value={val}
                        onChange={e => setEdit(p => ({ ...p, usage: { ...p.usage, [key]: Number(e.target.value) } }))}
                        className="w-14 border border-[#141414] rounded-md px-2 py-1.5 text-[13px] font-bold text-[#ededed] text-center bg-[#080808] focus:outline-none focus:border-[#2a2a2a] transition-colors"
                        style={{ fontFamily: "inherit" }}
                      />
                      <span className="text-[12px] font-medium text-[#2a2a2a] w-6 text-right shrink-0">{inf ? "∞" : lim}</span>
                    </div>
                  );
                })}
              </div>
            </Section>
          )}

          {/* ── Contact ── */}
          {tab === "contact" && (
            <Card>
              <CardTitle>Contact User</CardTitle>
              <ContactPanel user={user} token={token} onDone={() => {}} />
            </Card>
          )}

          {/* ── Raw ── */}
          {tab === "raw" && (
            <Section
              title={<><code className="font-mono text-[#0070f3] text-[12px] normal-case">profiles/{user.id}</code><CodeRef k="erpData" /></>}
              action={
                <button
                  onClick={() => navigator.clipboard?.writeText(JSON.stringify(user, null, 2))}
                  className="px-3 py-1.5 rounded-md border border-[#141414] bg-[#080808] text-[13px] font-medium cursor-pointer text-[#555] hover:text-[#e0e0e0] hover:border-[#2a2a2a] transition-all"
                >
                  Copy JSON
                </button>
              }
            >
              <pre className="bg-[#050505] border border-[#0f0f0f] text-[#666] rounded-xl p-5 text-[12px] leading-relaxed overflow-auto font-mono">
                {JSON.stringify(user, null, 2)}
              </pre>
            </Section>
          )}

        </div>
      </div>
    </div>
  );

  return (
    <div className="flex-1 flex overflow-hidden bg-black">
      {!isMobile && Sidebar}
      {Content}
    </div>
  );
}

// ── Section ───────────────────────────────────────────────────────────────────

function Section({ title, children, action }: {
  title: ReactNode; children: ReactNode; action?: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-3 min-h-7">
        <div className="flex items-center gap-2 text-[12px] font-semibold text-[#3a3a3a] uppercase tracking-widest">
          {title}
        </div>
        {action}
      </div>
      {children}
    </div>
  );
}

// ── FormCard ──────────────────────────────────────────────────────────────────

function FormCard({ children }: { children: ReactNode }) {
  return (
    <div className="bg-[#070707] border border-[#0f0f0f] rounded-xl p-5">
      {children}
    </div>
  );
}

// ── FormField ─────────────────────────────────────────────────────────────────

function FormField({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-2">
      <label className="text-[12px] font-semibold text-[#3a3a3a] uppercase tracking-wider">{label}</label>
      {children}
    </div>
  );
}
