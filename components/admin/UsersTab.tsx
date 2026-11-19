// components/admin/UsersTab.tsx
"use client";

import { confirmDialog } from "@/components/ui/dialog-host";
import { useState, useEffect, ReactNode } from "react";
import {
  User, AnalyticsData, PLANS, USAGE_FIELDS, LIMITS,
  planColor, statusColor, fmtFull, daysAgo,
  Avatar, CodeRef, Spinner, HBar, StatusDot, StudentChip, Checkbox,
  inputCls, Select, useIsMobile, Card, CardTitle, FRow, SkeletonTable, OriginBadge,
} from "./admin-shared";
import { StripeCoupon, PlanEditorPanel, CouponPanel } from "./StripeTab";
import { FollowUpPanel, EmailComposer, recipientFromUser } from "./FollowUp";
import { BonusPanel } from "./BonusPanel";
import { FEATURE_LABELS } from "@/lib/packs";
import { useUser360, OverviewPanel, JobSearchPanel, ActivityPanel, SupportPanel, AboutCard } from "./UserInsights";

// student_verifications.verification_method values written by the Dashboard
const STUDENT_METHOD_LABELS: Record<string, string> = {
  email_otp:      "Email code",
  legacy_import:  "Imported (Firebase)",
  legacy_coupon:  "Student coupon (legacy)",
  stripe_coupon:  "Student coupon",
  "email_otp+stripe_coupon": "Email code + student coupon",
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
        <path d="M4 0L7.5 5H0.5L4 0Z" fill="currentColor" className={active && dir === "asc" ? "text-fg-3" : "text-strong"} />
      </svg>
      <svg width="8" height="5" viewBox="0 0 8 5" fill="none">
        <path d="M4 5L0.5 0H7.5L4 5Z" fill="currentColor" className={active && dir === "desc" ? "text-fg-3" : "text-strong"} />
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
  // Users ticked for a group email, by id.
  const [picked, setPicked] = useState<Set<string>>(() => new Set());
  const [composing, setComposing] = useState(false);
  const isMobile = useIsMobile();

  const togglePick = (id: string) => setPicked(prev => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });
  const allFilteredPicked = filtered.length > 0 && filtered.every(u => picked.has(u.id));
  const somePicked = !allFilteredPicked && filtered.some(u => picked.has(u.id));
  const togglePickAll = () => setPicked(prev => {
    const next = new Set(prev);
    if (allFilteredPicked) filtered.forEach(u => next.delete(u.id)); else filtered.forEach(u => next.add(u.id));
    return next;
  });

  const sortableColumns = [
    { key: "name",      label: "User"   },
    { key: "plan",      label: "Plan"   },
    { key: "status",    label: "Status" },
    { key: "stripe",    label: "Stripe" },
    { key: "source",    label: "Source" },
    { key: "createdAt", label: "Joined" },
  ] as const;

  function handleSort(key: string, sortable: boolean) {
    if (!sortable) return;
    setSortF(key);
    setSortD(d => key === sortF ? (d === "asc" ? "desc" : "asc") : "asc");
  }

  if (composing) {
    const chosen = users.filter(u => picked.has(u.id));
    return (
      <div className="flex-1 overflow-auto bg-canvas">
        <div className="toolbar sticky top-0 z-10">
          <button onClick={() => setComposing(false)}
            className="btn btn-sm btn-ghost -ml-2.5">
            <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M15 18l-6-6 6-6"/></svg>
            Back to users
          </button>
        </div>
        <div className="p-4 md:p-6 w-full">
          <EmailComposer initialRecipients={chosen.map(recipientFromUser)} allUsers={users} token={token}
            title={chosen.length > 1 ? `Email ${chosen.length} users` : "New email"} />
        </div>
      </div>
    );
  }

  if (selectedUser) {
    return (
      <UserDetail
        allUsers={users}
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
      <div className="toolbar shrink-0">
        {/* Search */}
        <div className="relative flex-1 max-w-[340px]">
          <svg className="absolute left-3 top-1/2 -translate-y-1/2 text-fg-5 pointer-events-none shrink-0" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
            <circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/>
          </svg>
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search name, email, UID…"
            className="field pl-9 pr-9"
          />
          {search && (
            <button
              onClick={() => setSearch("")}
              aria-label="Clear search"
              className="btn btn-sm btn-ghost btn-icon absolute right-1 top-1/2 -translate-y-1/2"
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

        {/* Group email */}
        <div className="flex items-center gap-2 shrink-0">
          {picked.size > 0 && (
            <div className="flex items-center gap-1.5 h-9 pl-3 pr-1 rounded-lg border border-line bg-subtle">
              <span className="text-[13px] text-fg-3 num"><span className="text-fg font-semibold">{picked.size}</span> selected</span>
              <button onClick={() => setPicked(new Set())} aria-label="Clear selection" title="Clear selection"
                className="btn btn-sm btn-ghost btn-icon">
                <svg width="10" height="10" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24"><path d="M18 6L6 18M6 6l12 12"/></svg>
              </button>
            </div>
          )}
          <button onClick={() => setComposing(true)}
            className={`btn ${picked.size ? "btn-primary" : "btn-secondary"}`}>
            <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 7l9 6 9-6"/>
            </svg>
            {picked.size ? "Email selected" : "New email"}
          </button>
        </div>

        {/* Row count */}
        <div className="ml-auto flex items-baseline gap-1.5 shrink-0">
          <span className="text-[14px] font-semibold text-fg num">{filtered.length.toLocaleString()}</span>
          <span className="text-[13px] text-fg-4">
            {filtered.length !== users.length ? `of ${users.length.toLocaleString()} ` : ""}
            {filtered.length === 1 ? "user" : "users"}
          </span>
        </div>
      </div>

      {/* ── List ── */}
      <div className="flex-1 overflow-auto bg-canvas">
        {loading ? (
          <SkeletonTable rows={8} cols={6} />
        ) : isMobile ? (
          /* Mobile cards */
          <div className="flex flex-col divide-y divide-line-soft">
            {filtered.map(u => {
              const p = planColor(u.subscription?.plan);
              const s = statusColor(u.subscription?.status);
              return (
                <div
                  key={u.id}
                  onClick={() => setSelectedUser(u)}
                  className="px-4 py-4 cursor-pointer bg-canvas hover:bg-hover active:bg-hover transition-colors"
                >
                  <div className="flex items-start gap-3">
                    <Checkbox checked={picked.has(u.id)} onChange={() => togglePick(u.id)} label={`Select ${u.name ?? u.email ?? "user"}`} className="mt-3" />
                    <div className="w-0.5 self-stretch rounded-full shrink-0" style={{ background: p.accent }} />
                    <Avatar name={u.name} size={40} />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-baseline justify-between gap-2">
                        <span className="font-semibold text-[14px] text-fg truncate">{u.name ?? "Unknown"}</span>
                        <span className="text-[12px] text-fg-5 shrink-0">{daysAgo(u.createdAt)}</span>
                      </div>
                      <div className="text-[13px] text-fg-4 truncate mt-0.5">{u.email}</div>
                      <div className="flex items-center gap-2 mt-2 flex-wrap">
                        <span className={`badge capitalize ${p.tw}`}>{u.subscription?.plan ?? "free"}</span>
                        {u.subscription?.status && (
                          <div className="flex items-center gap-1.5">
                            <StatusDot color={s.dot} />
                            <span className="text-[12px] font-medium" style={{ color: s.text }}>{u.subscription.status}</span>
                          </div>
                        )}
                        {u.subscription?.stripeCustomerId && (
                          <span className="badge badge-success">Stripe</span>
                        )}
                        <StudentChip student={u.student} />
                        {u.origin && <OriginBadge origin={u.origin} compact />}
                      </div>
                    </div>
                    <svg className="text-fg-5 shrink-0 mt-1" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
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
              <col style={{ width: "44px" }} />
              <col style={{ width: "31%" }} />
              <col style={{ width: "11%" }} />
              <col style={{ width: "13%" }} />
              <col style={{ width: "13%" }} />
              <col style={{ width: "18%" }} />
              <col style={{ width: "14%" }} />
            </colgroup>
            <thead className="sticky top-0 z-10">
              <tr className="bg-surface border-b border-line-soft">
                <th className="pl-5 py-3 text-left">
                  <Checkbox checked={allFilteredPicked} indeterminate={somePicked} onChange={togglePickAll} label="Select all shown" />
                </th>
                {sortableColumns.map(({ key, label }) => {
                  const sortable = ["name", "plan", "createdAt"].includes(key);
                  const active = sortF === key;
                  return (
                    <th key={key} className="px-4 py-3 text-left select-none">
                      {sortable ? (
                        <button
                          onClick={() => handleSort(key, sortable)}
                          className="inline-flex items-center gap-0.5 cursor-pointer border-0 bg-transparent p-0 font-[inherit] group"
                        >
                          <span className={`label ${active ? "text-fg-2!" : "group-hover:text-fg-3"}`}>{label}</span>
                          <SortChevrons active={active} dir={sortD} />
                        </button>
                      ) : (
                        <span className="label">{label}</span>
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
                    className={`border-b border-line-soft cursor-pointer transition-colors group ${picked.has(u.id) ? "bg-brand-soft hover:bg-hover" : "bg-canvas hover:bg-hover"}`}
                  >
                    <td className="pl-5 py-3.5" onClick={e => e.stopPropagation()}>
                      <Checkbox checked={picked.has(u.id)} onChange={() => togglePick(u.id)} label={`Select ${u.name ?? u.email ?? "user"}`} />
                    </td>
                    {/* User */}
                    <td className="px-4 py-3.5">
                      <div className="flex items-center gap-3">
                        <div
                          className="w-0.5 h-9 rounded-full shrink-0 transition-opacity opacity-50 group-hover:opacity-100"
                          style={{ background: p.accent }}
                        />
                        <Avatar name={u.name} size={36} />
                        <div className="min-w-0">
                          {/* Name never shrinks below its width; the badge wraps under it when the column is narrow */}
                          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 min-w-0">
                            <span className="text-[14px] font-semibold text-fg truncate leading-tight shrink-0 max-w-full">{u.name ?? "Unknown"}</span>
                            <StudentChip student={u.student} compact className="shrink-0" />
                            {(u.emailOptOuts?.length ?? 0) > 0 && (
                              <span title={`Turned off: ${u.emailOptOuts!.join(", ")}`}
                                className="badge badge-warning shrink-0">
                                {u.emailOptOuts!.length >= 3 ? "Unsubscribed" : "Some emails off"}
                              </span>
                            )}
                          </div>
                          <div className="text-[13px] text-fg-4 truncate mt-0.5">{u.email}</div>
                        </div>
                      </div>
                    </td>
                    {/* Plan */}
                    <td className="px-4 py-3.5">
                      <span className={`badge ${p.tw}`}>
                        {(u.subscription?.plan ?? "free").charAt(0).toUpperCase() + (u.subscription?.plan ?? "free").slice(1)}
                      </span>
                    </td>
                    {/* Status */}
                    <td className="px-4 py-3.5">
                      {u.subscription?.status ? (
                        <div className="flex items-center gap-2">
                          <StatusDot color={s.dot} />
                          <span className="text-[13px] font-medium" style={{ color: s.text }}>{u.subscription.status}</span>
                        </div>
                      ) : (
                        <span className="text-[14px] text-fg-5">—</span>
                      )}
                    </td>
                    {/* Stripe */}
                    <td className="px-4 py-3.5">
                      {u.subscription?.stripeCustomerId ? (
                        <div className="flex items-center gap-1.5">
                          <svg className="text-success-fg" width="11" height="11" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
                            <polyline points="20 6 9 17 4 12"/>
                          </svg>
                          <span className="text-[13px] font-medium text-success-fg">Connected</span>
                        </div>
                      ) : (
                        <span className="text-[14px] text-fg-5">—</span>
                      )}
                    </td>
                    {/* Source */}
                    <td className="px-4 py-3.5">
                      <OriginBadge origin={u.origin} compact />
                    </td>
                    {/* Joined */}
                    <td className="px-4 py-3.5">
                      <span className="text-[13px] font-medium text-fg-4">{daysAgo(u.createdAt)}</span>
                    </td>
                  </tr>
                );
              })}
              {!filtered.length && (
                <tr><td colSpan={7}><EmptyState search={search} /></td></tr>
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
      <div className="w-14 h-14 rounded-xl bg-surface border border-line-soft flex items-center justify-center">
        <svg className="text-fg-5" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24">
          <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/>
          <circle cx="9" cy="7" r="4"/>
          <path d="M23 21v-2a4 4 0 0 0-3-3.87"/>
          <path d="M16 3.13a4 4 0 0 1 0 7.75"/>
        </svg>
      </div>
      <div className="flex flex-col gap-1">
        <span className="text-[14px] font-semibold text-fg-3">No users found</span>
        {search && <span className="text-[13px] text-fg-4">No results for &ldquo;{search}&rdquo;</span>}
      </div>
    </div>
  );
}

// ── UserDetail ────────────────────────────────────────────────────────────────

const DETAIL_TABS = [
  {
    id: "overview",
    label: "Overview",
    icon: (
      <svg width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
        <rect x="3" y="3" width="7" height="9" rx="1"/><rect x="14" y="3" width="7" height="5" rx="1"/>
        <rect x="14" y="12" width="7" height="9" rx="1"/><rect x="3" y="16" width="7" height="5" rx="1"/>
      </svg>
    ),
  },
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
    id: "bonuses",
    label: "Bonuses",
    icon: (
      <svg width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
        <rect x="3" y="8" width="18" height="13" rx="1"/><path d="M12 8v13M3 12h18M12 8c-1.5-3-5-4-5-1.5S10 8 12 8Zm0 0c1.5-3 5-4 5-1.5S14 8 12 8Z"/>
      </svg>
    ),
  },
  {
    id: "jobsearch",
    label: "Job search",
    icon: (
      <svg width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
        <rect x="2" y="7" width="20" height="14" rx="2"/><path d="M16 7V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v2"/>
      </svg>
    ),
  },
  {
    id: "activity",
    label: "Activity",
    icon: (
      <svg width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
        <polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/>
      </svg>
    ),
  },
  {
    id: "support",
    label: "Support",
    icon: (
      <svg width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
        <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
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
  user: initialUser, onClose, onUserUpdate, saveUser, saving, msg, token = "", allUsers,
}: {
  user: User; onClose: () => void; onUserUpdate?: (u: User) => void;
  saveUser: (u: User) => Promise<void>; saving: boolean; msg: string; token?: string;
  allUsers?: User[];
}) {
  const isMobile = useIsMobile();
  const [user, setUser] = useState<User>(initialUser);
  const [edit, setEdit] = useState<User>(JSON.parse(JSON.stringify(initialUser)));
  const [tab, setTab]   = useState<DetailTab>("overview");
  const insights        = useUser360(initialUser.id, token);
  const panelProps      = { user, d: insights.data, loading: insights.loading, error: insights.error, reload: insights.reload, token };
  const [coupons, setCoupons]           = useState<StripeCoupon[]>([]);
  const [loadingCoupons, setLoadingCoupons] = useState(true);
  const [couponMsg, setCouponMsg]       = useState("");
  const pc = planColor(user.subscription?.plan);
  const sc = statusColor(user.subscription?.status);
  const totalUsage = USAGE_FIELDS.reduce((s, { key }) => s + ((user.usage?.[key] as number) ?? 0), 0);
  // Save / Discard only apply to the tabs with editable fields
  const isEditableTab = tab === "profile" || tab === "subscription" || tab === "usage";

  useEffect(() => {
    setLoadingCoupons(true);
    (async () => {
      try {
        const res  = await fetch("/api/admin?action=coupons", { headers: token ? { "x-admin-token": token } : {} });
        const json = await res.json() as { coupons?: StripeCoupon[]; error?: string };
        if (res.ok && json.coupons) setCoupons(json.coupons);
        else setCouponMsg(`Could not load coupons: ${json.error ?? `HTTP ${res.status}`}`);
      } catch (e) { setCouponMsg(`Could not load coupons: ${(e as Error).message}`); }
      setLoadingCoupons(false);
    })();
  }, [token]);

  function handleSave()    { void saveUser(edit); }
  function handleDiscard() { setEdit(JSON.parse(JSON.stringify(user))); }

  // ── Sidebar ──

  const Sidebar = (
    <div className="w-1/3 shrink-0 border-r border-line-soft flex flex-col bg-subtle overflow-y-auto">

      {/* Accent bar */}
      <div className="h-[2px] shrink-0" style={{ background: pc.accent }} />

      {/* Back + label */}
      <div className="flex items-center gap-2.5 px-2 h-12 border-b border-line-soft shrink-0">
        <button onClick={onClose} className="btn btn-sm btn-ghost">
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
            <path d="M15 18l-6-6 6-6"/>
          </svg>
          All users
        </button>
      </div>

      {/* Identity */}
      <div className="px-5 py-6 flex flex-col items-center text-center gap-4 border-b border-line-soft">
        <div className="relative">
          <Avatar name={user.name} size={72} />
          {user.isAdmin && (
            <div className="absolute -bottom-1 -right-1 w-5 h-5 rounded-full bg-warning flex items-center justify-center ring-2 ring-subtle" title="Admin">
              <svg className="text-white" width="8" height="8" fill="currentColor" viewBox="0 0 24 24">
                <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/>
              </svg>
            </div>
          )}
        </div>
        <div className="w-full">
          <div className="text-[15px] font-semibold text-fg leading-snug">{user.name ?? "Unknown"}</div>
          <div className="text-[13px] text-fg-4 mt-1 break-all">{user.email}</div>
        </div>
        <div className="flex items-center gap-1.5 flex-wrap justify-center">
          <span className={`badge ${pc.tw}`}>
            {(user.subscription?.plan ?? "free").charAt(0).toUpperCase() + (user.subscription?.plan ?? "free").slice(1)}
          </span>
          {user.subscription?.status && (
            <div className="flex items-center gap-1.5">
              <StatusDot color={sc.dot} />
              <span className="text-[12px] font-medium" style={{ color: sc.text }}>{user.subscription.status}</span>
            </div>
          )}
          {user.subscription?.stripeCustomerId && (
            <span className="badge badge-success">Stripe</span>
          )}
          {user.isAdmin && (
            <span className="badge badge-warning">Admin</span>
          )}
          <StudentChip student={user.student} />
        </div>
      </div>

      {/* Stat cards */}
      <div className="px-4 py-4 grid grid-cols-2 gap-2 border-b border-line-soft">
        {[
          { label: "Joined",      value: daysAgo(user.createdAt) },
          { label: "Last active", value: daysAgo(user.lastLogin ?? user.updatedAt) },
          { label: "Provider",    value: user.provider ?? "email" },
          { label: "Uses this period", value: String(totalUsage) },
        ].map(({ label, value }) => (
          <div key={label} className="bg-surface border border-line-soft rounded-lg px-3 py-2.5">
            <div className="label mb-1">{label}</div>
            <div className="text-[13px] font-semibold text-fg-2 capitalize truncate">{value || <span className="text-fg-5">—</span>}</div>
          </div>
        ))}
      </div>

      {/* Where they came from */}
      <div className="px-4 py-4 border-b border-line-soft">
        <div className="label mb-2.5">Signed up from</div>
        {user.origin ? (
          <div className="bg-surface border border-line-soft rounded-lg overflow-hidden divide-y divide-line-soft">
            <div className="flex items-center justify-between gap-2 px-3 py-2">
              <span className="label">Source</span>
              <OriginBadge origin={user.origin} />
            </div>
            {[
              { label: "Campaign",   value: user.origin.campaign },
              { label: "Medium",     value: user.origin.medium },
              { label: "Referrer",   value: user.origin.referrerHost },
              { label: "First page", value: user.origin.landing, mono: true },
              { label: "Path",       value: user.origin.via === "site" ? "preciprocal.com → app" : "Straight to the app" },
              { label: "First visit", value: fmtFull(user.origin.at) },
            ].filter(r => r.value).map(({ label, value, mono }) => (
              <div key={label} className="flex items-center justify-between gap-3 px-3 py-2">
                <span className="label shrink-0">{label}</span>
                <span className={`truncate text-right ${mono ? "font-mono text-[11px] text-fg-3" : "text-[12px] font-medium text-fg-3"}`} title={value}>{value}</span>
              </div>
            ))}
          </div>
        ) : (
          <div className="text-caption">Not recorded. This account was created before sign-up sources were tracked.</div>
        )}
      </div>

      {/* Subscription summary */}
      <div className="px-4 py-4 border-b border-line-soft">
        <div className="label mb-2.5">Subscription</div>
        <div className="bg-surface border border-line-soft rounded-lg overflow-hidden divide-y divide-line-soft">
          {[
            { label: "Plan",       value: (user.subscription?.plan ?? "free").charAt(0).toUpperCase() + (user.subscription?.plan ?? "free").slice(1) },
            { label: "Status",     value: user.subscription?.status ?? "—" },
            { label: "Period end", value: fmtFull(user.subscription?.currentPeriodEnd) || "—" },
            { label: "Interviews", value: `${user.usage?.interviewsUsed ?? 0} / ${(LIMITS[user.subscription?.plan ?? "free"]?.interviewsUsed ?? 0) < 0 ? "∞" : (LIMITS[user.subscription?.plan ?? "free"]?.interviewsUsed ?? 0)}` },
            { label: "Pack credits", value: user.packs?.totalCredits ? String(user.packs.totalCredits) : "—" },
          ].map(({ label, value }) => (
            <div key={label} className="flex items-center justify-between px-3 py-2">
              <span className="label">{label}</span>
              <span className="text-[12px] font-medium text-fg-3 truncate max-w-[60%] text-right">{value}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Stripe IDs */}
      {(user.subscription?.stripeCustomerId || user.subscription?.stripeSubscriptionId) && (
        <div className="px-4 py-4 border-b border-line-soft">
          <div className="label mb-2.5">Stripe</div>
          <div className="bg-surface border border-line-soft rounded-lg overflow-hidden divide-y divide-line-soft">
            {[["cus", user.subscription.stripeCustomerId], ["sub", user.subscription.stripeSubscriptionId]]
              .filter(([, v]) => v)
              .map(([prefix, val]) => (
                <div key={prefix} className="flex items-center gap-2.5 px-3 py-2.5">
                  <span className="label w-6 shrink-0">{prefix}</span>
                  <code className="font-mono text-[11px] text-brand-fg truncate flex-1">{val}</code>
                  <button
                    onClick={() => navigator.clipboard?.writeText(val as string)}
                    className="link text-[12px] shrink-0"
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
        <div className="label mb-2">User ID</div>
        <div className="flex items-center gap-2 bg-surface border border-line-soft rounded-lg px-3 py-2">
          <code className="font-mono text-[11px] text-fg-4 tracking-wide truncate flex-1">{user.id}</code>
          <button
            onClick={() => navigator.clipboard?.writeText(user.id)}
            className="link text-[12px] shrink-0"
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
        <div className="flex items-center gap-3 px-4 h-12 border-b border-line-soft shrink-0 bg-canvas">
          <button onClick={onClose} className="btn btn-sm btn-ghost -ml-2.5">
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
              <path d="M15 18l-6-6 6-6"/>
            </svg>
            All users
          </button>
          <div className="w-px h-4 bg-line mx-1" />
          <span className="text-[13px] font-semibold text-fg truncate">{user.name ?? "Unknown"}</span>
        </div>
      )}

      {/* Tab bar + actions */}
      <div className="tabs items-center px-3 md:px-5 shrink-0 bg-canvas">
        {DETAIL_TABS.map(t => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`tab shrink-0 ${tab === t.id ? "tab-active" : ""}`}
          >
            <span className={tab === t.id ? "text-fg-3" : "text-fg-5"}>{t.icon}</span>
            {t.label}
          </button>
        ))}

        {isEditableTab && (
          <div className="ml-auto flex items-center gap-2.5 shrink-0">
            {msg && (
              <span className={`text-[13px] font-medium ${msg.startsWith("✓") ? "text-success-fg" : "text-danger-fg"}`}>
                {msg}
              </span>
            )}
            <button onClick={handleDiscard} className="btn btn-sm btn-secondary">
              Discard
            </button>
            <button
              onClick={handleSave}
              disabled={saving}
              className="btn btn-sm btn-primary"
            >
              {saving ? "Saving…" : "Save changes"}
            </button>
          </div>
        )}
      </div>

      {/* Content area */}
      <div className="flex-1 overflow-auto">
        <div className="p-4 md:p-6 flex flex-col gap-5 w-full">

          {/* ── Overview / Job search / Activity / Support (UserInsights.tsx) ── */}
          {tab === "overview"  && <OverviewPanel  {...panelProps} />}
          {tab === "jobsearch" && <JobSearchPanel {...panelProps} />}
          {tab === "activity"  && <ActivityPanel  {...panelProps} />}
          {tab === "support"   && <SupportPanel   {...panelProps} />}

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
                          className="link text-[12px] absolute right-3 top-1/2 -translate-y-1/2"
                        >
                          Copy
                        </button>
                      </div>
                    </FormField>
                    <FormField label="Admin access">
                      <Select
                        value={String(edit.isAdmin ?? false)}
                        onChange={async e => {
                          const on = e.target.value === "true";
                          // Admin in the Dashboard means unlimited usage and the refund approval queue.
                          if (on && !(await confirmDialog({ title: "Make this user an admin?", message: `${edit.email ?? "This user"} gets unlimited usage and access to the refund review queue in the app. It takes effect when you save.`, confirmLabel: "Make admin", tone: "danger" }))) return;
                          setEdit(p => ({ ...p, isAdmin: on }));
                        }}
                      >
                        <option value="false">No</option>
                        <option value="true">Yes</option>
                      </Select>
                    </FormField>
                    <FormField label="Auth provider">
                      <div className={`${inputCls} text-fg-4 cursor-default capitalize select-none`}>{user.provider ?? "email"}</div>
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
                    <div key={label} className="card px-4 py-3">
                      <div className="label mb-1.5">{label}</div>
                      <div className={`truncate font-medium ${mono ? "font-mono text-brand-fg text-[11px]" : "text-[13px] text-fg-2"}`}>
                        {value || <span className="text-fg-5">—</span>}
                      </div>
                      {label === "User ID" && value && (
                        <button
                          onClick={() => navigator.clipboard?.writeText(value)}
                          className="link mt-1 text-[11px]"
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

          {/* Read-only career profile under the editable identity fields */}
          {tab === "profile" && <AboutCard {...panelProps} />}

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
                  <div className={`mb-3 px-3 py-2 rounded-lg text-[12px] font-medium ${couponMsg.startsWith("✗") ? "bg-danger-soft border border-danger-line text-danger-fg" : "bg-success-soft border border-success-line text-success-fg"}`}>
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
                <FRow label="Plan"         badgeLabel={user.subscription?.plan ?? "free"} badgeClassName={`border capitalize ${planColor(user.subscription?.plan).tw}`} />
                <FRow label="Status"       badgeLabel={user.subscription?.status ?? ""} badgeClassName="badge-neutral border-line" />
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
                  <div className="text-[13px] text-fg-4">Hasn&apos;t verified a student email.</div>
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
                  className="btn btn-sm btn-success"
                >
                  Reset all
                </button>
              }
            >
              <div className="card overflow-hidden divide-y divide-line-soft">
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
                      <span className="text-[13px] text-fg-2 font-medium w-32 shrink-0">{label}</span>
                      <HBar pct={pct} color={over ? "#ef4444" : color} />
                      <input
                        type="number"
                        min={0}
                        value={val}
                        onChange={e => setEdit(p => ({ ...p, usage: { ...p.usage, [key]: Number(e.target.value) } }))}
                        className="field field-sm w-16 px-2 text-center font-semibold num"
                      />
                      <span className="text-[12px] font-medium text-fg-5 w-6 text-right shrink-0">{inf ? "∞" : lim}</span>
                    </div>
                  );
                })}
              </div>
            </Section>
          )}

          {/* ── Contact ── */}
          {tab === "bonuses" && <BonusPanel user={user} token={token} />}

          {tab === "contact" && (
            <FollowUpPanel user={user} token={token} allUsers={allUsers} />
          )}

          {/* ── Raw ── */}
          {tab === "raw" && (
            <Section
              title={<><code className="font-mono text-brand-fg text-[12px] normal-case">profiles/{user.id}</code><CodeRef k="erpData" /></>}
              action={
                <button
                  onClick={() => navigator.clipboard?.writeText(JSON.stringify(user, null, 2))}
                  className="btn btn-sm btn-secondary"
                >
                  Copy JSON
                </button>
              }
            >
              <pre className="bg-subtle border border-line text-fg-3 rounded-xl p-5 text-[12px] leading-relaxed overflow-auto font-mono">
                {JSON.stringify(user, null, 2)}
              </pre>
            </Section>
          )}

        </div>
      </div>
    </div>
  );

  return (
    <div className="flex-1 flex overflow-hidden bg-canvas">
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
        <div className="flex items-center gap-2 section-title">
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
    <div className="card card-pad">
      {children}
    </div>
  );
}

// ── FormField ─────────────────────────────────────────────────────────────────

function FormField({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-2">
      <label className="field-label mb-0">{label}</label>
      {children}
    </div>
  );
}
