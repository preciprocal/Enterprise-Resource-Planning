// lib/extension-events.ts — shared by the server loaders and the client tabs.
// extension_events.event values, from the Dashboard's migration
// 0072_extension_telemetry.sql. Unknown values are shown humanised.

export const EXT_EVENT_LABEL: Record<string, string> = {
  installed: "Installed", updated: "Updated", uninstalled: "Uninstalled", startup: "Browser start",
  popup_opened: "Opened popup", signed_in: "Signed in", signed_out: "Signed out",
  job_analyzed: "Job analysis", job_fit: "Fit check", job_signals: "Job signals", everify_checked: "E-Verify check",
  autofill: "Autofill profile loaded", job_tracked: "Job tracked",
  upsell_shown: "Pro prompt shown", upsell_dismissed: "Pro prompt dismissed", upsell_clicked: "Pro prompt clicked",
};

/** What people use it for, in display order (the per-user table's columns). */
export const EXT_USE_EVENTS = ["job_analyzed", "job_fit", "job_signals", "everify_checked", "autofill", "job_tracked"] as const;
/** Install lifecycle and housekeeping: counted, but not "use". */
export const EXT_LIFECYCLE_EVENTS = new Set(["installed", "updated", "uninstalled", "startup", "popup_opened", "signed_in", "signed_out"]);
export const EXT_UPSELL_EVENTS = ["upsell_shown", "upsell_dismissed", "upsell_clicked"] as const;

export const extEventLabel = (e: string) => EXT_EVENT_LABEL[e] ?? e.replace(/[-_]+/g, " ").replace(/^\w/, c => c.toUpperCase());

/** autofill = the extension fetched the autofill profile (auto-apply route),
 *  not a confirmed form fill. Before 1.14.0 the LinkedIn banner also
 *  prefetched it on every job page, so older counts run high. */
export const EXT_AUTOFILL_NOTE = "Autofill counts the times the extension loaded the autofill profile, not confirmed form fills. Before 1.14.0 the LinkedIn banner prefetched it on every job page, so counts from older versions run high.";

/** First version the telemetry ships in; shown while the tables are empty or missing. */
export const EXT_TRACKING_NOTE = "Install and usage tracking starts with extension 1.14. Until then only jobs saved through the extension are visible.";

/** "1.13.2" > "1.9.0" */
export function compareVersions(a: string, b: string) {
  const pa = a.split(/[.-]/).map(x => parseInt(x) || 0), pb = b.split(/[.-]/).map(x => parseInt(x) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) { const d = (pa[i] ?? 0) - (pb[i] ?? 0); if (d) return d; }
  return 0;
}
