// lib/packs.ts
// One-time credit packs sold through Stripe. Mirrors PACKS in the Dashboard's
// lib/config/packs.ts — keep the two in sync. Grants are keyed by the
// Dashboard's FeatureType names (what credit_packs.granted stores), not by
// usage_counters column names.
//
// Price IDs are resolved server-side from STRIPE_PACK_<KEY>_PRICE_ID, the same
// env vars the Dashboard uses.

export type PackKey = "starter_pack" | "application_boost" | "networking_pack" | "interview_boost";

export interface PackDefinition {
  key: PackKey;
  name: string;
  priceUsd: number;
  grants: Record<string, number>;
}

export const PACKS: Record<PackKey, PackDefinition> = {
  starter_pack: {
    key: "starter_pack", name: "Starter Pack", priceUsd: 4.99,
    grants: { interviews: 1, resumes: 5, coverLetters: 15, findContacts: 2, linkedinOptimisations: 2, coldOutreach: 2, interviewDebriefs: 2 },
  },
  application_boost: {
    key: "application_boost", name: "Application Boost", priceUsd: 4.99,
    grants: { resumes: 10, coverLetters: 15 },
  },
  networking_pack: {
    key: "networking_pack", name: "Networking Pack", priceUsd: 4.99,
    grants: { findContacts: 15, linkedinOptimisations: 3, coldOutreach: 15 },
  },
  interview_boost: {
    key: "interview_boost", name: "Interview Boost", priceUsd: 6.49,
    grants: { interviews: 2, interviewDebriefs: 3 },
  },
};

export const PACK_KEYS = Object.keys(PACKS) as PackKey[];

/** Display labels for FeatureType grant keys. */
export const FEATURE_LABELS: Record<string, string> = {
  interviews: "Interviews", resumes: "Resumes", coverLetters: "Cover Letters",
  findContacts: "Find Contacts", linkedinOptimisations: "LinkedIn", coldOutreach: "Cold Outreach",
  interviewDebriefs: "Debriefs", debriefAnalyses: "Debrief Analyses", studyPlans: "Study Plans",
};

export function packEnvVar(key: PackKey): string {
  return `STRIPE_PACK_${key.toUpperCase()}_PRICE_ID`;
}

/**
 * Standalone bonuses: credits for any metered feature, not tied to a pack.
 * Stored like other bonuses (credit_packs row, no payment) under this key.
 * The Dashboard spends pack credits by feature, whatever the pack key.
 * jobTracker is left out: it has no server-side metering, so a credit there
 * could never be spent.
 */
export const STANDALONE_KEY = "bonus";
/** Reference amount per feature for the Low/Moderate/High/Full presets. */
export const STANDALONE_BASE: Record<string, number> = {
  interviews: 4, resumes: 10, coverLetters: 15, studyPlans: 3, interviewDebriefs: 5,
  debriefAnalyses: 5, linkedinOptimisations: 5, coldOutreach: 20, findContacts: 20,
};
/** Most that can be given per feature in one standalone bonus. */
export const STANDALONE_MAX = 100;
