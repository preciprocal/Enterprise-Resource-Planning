// lib/packs.ts
// One-time credit packs sold through Stripe. Mirrors PACKS in the Dashboard's
// lib/config/packs.ts (single packs plus a group copy of each for 4 people) — keep the two in sync. Grants are keyed by the
// Dashboard's FeatureType names (what credit_packs.granted stores), not by
// usage_counters column names.
//
// Price IDs are resolved server-side from STRIPE_PACK_<KEY>_PRICE_ID, the same
// env vars the Dashboard uses.

export type SinglePackKey =
  | "starter_pack" | "job_applications" | "application_boost"
  | "networking_pack" | "prep_pack" | "interview_boost";
/** The same pack for 4 people, shared by invite link (Dashboard migration 0068). */
export type GroupPackKey = `group_${SinglePackKey}`;
export type PackKey = SinglePackKey | GroupPackKey;

export interface PackDefinition {
  key: PackKey;
  name: string;
  priceUsd: number;
  grants: Record<string, number>;
  description: string;
  /** Group packs: how many people get the full pack. */
  seats?: number;
  /** Group packs: the single pack they're a copy of. */
  base?: SinglePackKey;
  /** Price still being tested on the Dashboard. */
  provisionalPricing?: boolean;
}

const SINGLE_PACKS: Record<SinglePackKey, PackDefinition> = {
  starter_pack: {
    key: "starter_pack", name: "Starter Pack", priceUsd: 4.99,
    grants: { interviews: 1, resumes: 5, coverLetters: 15, findContacts: 2, linkedinOptimisations: 2, coldOutreach: 2 },
    description: "A bit of everything: one mock interview, applications, and career tools.",
  },
  job_applications: {
    key: "job_applications", name: "Job Application Pack", priceUsd: 4.99, provisionalPricing: true,
    grants: { applications: 5 },
    description: "Five more jobs taken through Apply: a tailored resume, cover letter and prep for each.",
  },
  application_boost: {
    key: "application_boost", name: "Resume and Letter Pack", priceUsd: 4.99,
    grants: { resumes: 10, coverLetters: 15 },
    description: "For a heavy application week.",
  },
  networking_pack: {
    key: "networking_pack", name: "Networking Pack", priceUsd: 4.99,
    grants: { findContacts: 15, linkedinOptimisations: 3, coldOutreach: 15 },
    description: "Find the right people, polish your profile, and reach out.",
  },
  prep_pack: {
    key: "prep_pack", name: "Prep Pack", priceUsd: 4.99,
    grants: { studyPlans: 3, debriefAnalyses: 2 },
    description: "Three more study plans and two AI analyses of your real interviews.",
  },
  interview_boost: {
    key: "interview_boost", name: "Interview Boost", priceUsd: 6.49,
    grants: { interviews: 2 },
    description: "Two more practice interviews.",
  },
};

export const GROUP_SEATS = 4;
const GROUP_PRICE_USD: Record<SinglePackKey, number> = {
  starter_pack: 14.99, job_applications: 14.99, application_boost: 14.99,
  networking_pack: 14.99, prep_pack: 14.99, interview_boost: 22.49,
};
const GROUP_PACKS = Object.fromEntries(
  (Object.keys(SINGLE_PACKS) as SinglePackKey[]).map(k => {
    const p = SINGLE_PACKS[k], key = `group_${k}` as GroupPackKey;
    return [key, { ...p, key, name: `Group ${p.name}`, priceUsd: GROUP_PRICE_USD[k], seats: GROUP_SEATS, base: k,
      description: `For ${GROUP_SEATS} people: you and 3 friends each get the full pack.` }];
  }),
) as Record<GroupPackKey, PackDefinition>;

export const PACKS: Record<PackKey, PackDefinition> = { ...SINGLE_PACKS, ...GROUP_PACKS };
/** Single packs only: what a bonus can be modelled on (a group pack grants the same per person). */
export const SINGLE_PACK_KEYS = Object.keys(SINGLE_PACKS) as SinglePackKey[];
export const isGroupPack = (key: string): key is GroupPackKey => key.startsWith("group_") && key in PACKS;

export const PACK_KEYS = Object.keys(PACKS) as PackKey[];

/** Display labels for FeatureType grant keys. */
export const FEATURE_LABELS: Record<string, string> = {
  applications: "Applications", interviews: "Interviews", resumes: "Resumes", coverLetters: "Cover Letters",
  findContacts: "Find Contacts", linkedinOptimisations: "LinkedIn", coldOutreach: "Cold Outreach",
  interviewDebriefs: "Journal Entries", debriefAnalyses: "Interview Analyses", studyPlans: "Study Plans",
};

export function packEnvVar(key: PackKey): string {
  return `STRIPE_PACK_${key.toUpperCase()}_PRICE_ID`;
}

/**
 * Standalone bonuses: credits for any metered feature, not tied to a pack.
 * Stored like other bonuses (credit_packs row, no payment) under this key.
 * The Dashboard spends pack credits by feature, whatever the pack key.
 * jobTracker and interviewDebriefs are left out: both are unlimited on every
 * plan (and jobTracker has no server-side metering), so a credit there could
 * never be spent.
 */
export const STANDALONE_KEY = "bonus";
/** Reference amount per feature for the Low/Moderate/High/Full presets. */
export const STANDALONE_BASE: Record<string, number> = {
  applications: 5, interviews: 4, resumes: 10, coverLetters: 15, studyPlans: 3,
  debriefAnalyses: 5, linkedinOptimisations: 5, coldOutreach: 20, findContacts: 20,
};
/** Most that can be given per feature in one standalone bonus. */
export const STANDALONE_MAX = 100;
