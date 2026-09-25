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
