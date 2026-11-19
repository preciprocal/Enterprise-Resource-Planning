// lib/attribution.ts
// Where each user came from when they signed up.
//
// The Dashboard stores profiles.signup_attribution once per new account
// (Dashboard repo: lib/attribution.ts, app/api/attribution, migration 0071):
//   - sid / vid: the preciprocal.com analytics session (and consented visitor)
//     they clicked through from. web_sessions already has the source, channel,
//     UTM tags and entry page for that visit, so it is looked up here.
//   - referrer / utm_* / click_id: for people who went straight to the app.
//     These are classified with the same rules as the landing site's collector
//     (Landing-Page app/api/collect/route.ts: SOURCE_MAP, channelOf), so a
//     source reads the same in Marketing and on a user.
import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

export interface Origin {
  /** "Google", "LinkedIn", "ChatGPT", a utm_source, a referring host, or "Direct". */
  source: string;
  /** organic · paid · social · ai · email · referral · campaign · affiliate · direct */
  channel: string;
  via: "site" | "app";
  campaign?: string;
  medium?: string;
  referrerHost?: string;
  /** First page they saw: on preciprocal.com when via "site", else in the app. */
  landing?: string;
  /** Analytics visitor key for Marketing → Visitors (visitor id, else the session's daily anon id). */
  visitorKey?: string;
  visitorPersistent?: boolean;
  at?: string;
}

interface Stored {
  sid?: string; vid?: string; referrer?: string;
  utm_source?: string; utm_medium?: string; utm_campaign?: string; utm_term?: string; utm_content?: string;
  click_id?: string; landing?: string; at?: string; direct?: boolean;
}

const SOURCE_MAP: Array<[RegExp, string, string]> = [
  [/^(www\.)?google\./, "Google", "organic"],
  [/^(www\.)?bing\./, "Bing", "organic"],
  [/duckduckgo\./, "DuckDuckGo", "organic"],
  [/^(.*\.)?yahoo\./, "Yahoo", "organic"],
  [/ecosia\./, "Ecosia", "organic"],
  [/search\.brave\./, "Brave Search", "organic"],
  [/baidu\./, "Baidu", "organic"],
  [/yandex\./, "Yandex", "organic"],
  [/chatgpt\.com|chat\.openai\.com/, "ChatGPT", "ai"],
  [/perplexity\./, "Perplexity", "ai"],
  [/claude\.ai/, "Claude", "ai"],
  [/gemini\.google\.|bard\.google\./, "Gemini", "ai"],
  [/copilot\.microsoft\./, "Copilot", "ai"],
  [/lnkd\.in|linkedin\./, "LinkedIn", "social"],
  [/^(.*\.)?t\.co$|twitter\.com|^x\.com$|^(.*\.)?x\.com$/, "X", "social"],
  [/facebook\.|fb\.me|fb\.com/, "Facebook", "social"],
  [/instagram\./, "Instagram", "social"],
  [/reddit\.|redd\.it/, "Reddit", "social"],
  [/tiktok\./, "TikTok", "social"],
  [/youtube\.|youtu\.be/, "YouTube", "social"],
  [/pinterest\./, "Pinterest", "social"],
  [/threads\.net/, "Threads", "social"],
  [/discord\.|discord\.gg/, "Discord", "social"],
  [/t\.me|telegram\./, "Telegram", "social"],
  [/whatsapp\./, "WhatsApp", "social"],
  [/news\.ycombinator\./, "Hacker News", "social"],
  [/quora\./, "Quora", "social"],
  [/medium\./, "Medium", "referral"],
  [/substack\./, "Substack", "referral"],
  [/github\./, "GitHub", "referral"],
  [/producthunt\./, "Product Hunt", "referral"],
  [/mail\.google\.|outlook\.|mail\.yahoo\.|mail\.proton/, "Webmail", "email"],
];

function sourceOf(host: string | null): { name: string | null; channel: string | null } {
  if (!host) return { name: null, channel: null };
  for (const [re, name, channel] of SOURCE_MAP) if (re.test(host)) return { name, channel };
  return { name: host, channel: "referral" };
}

function channelOf(host: string | null, medium?: string, source?: string, clickId?: string): string {
  const m = (medium || "").toLowerCase();
  if (m.includes("cpc") || m.includes("ppc") || m.includes("paid") || m.includes("display")) return "paid";
  if (m.includes("email") || m.includes("newsletter")) return "email";
  if (m.includes("social") || m.includes("paid-social")) return "social";
  if (m.includes("affiliate")) return "affiliate";
  if (m.includes("referral")) return "referral";
  if (m.includes("organic")) return "organic";
  if (clickId) return "paid";
  const fromReferrer = sourceOf(host).channel;
  if (fromReferrer) return fromReferrer;
  if (source) return "campaign";
  return "direct";
}

const hostOf = (url?: string) => {
  if (!url) return null;
  try { return new URL(url).hostname.replace(/^www\./, ""); } catch { return null; }
};

function fromApp(a: Stored): Origin {
  const host = hostOf(a.referrer);
  const resolved = sourceOf(host);
  const channel = channelOf(host, a.utm_medium, a.utm_source, a.click_id);
  return {
    source: a.utm_source || resolved.name || (a.click_id ? clickIdSource(a.click_id) : "Direct"),
    channel, via: "app",
    campaign: a.utm_campaign, medium: a.utm_medium,
    referrerHost: host ?? undefined, landing: a.landing, at: a.at,
  };
}

function clickIdSource(id: string) {
  if (id === "msclkid") return "Bing Ads";
  if (id === "fbclid") return "Facebook";
  if (id === "li_fat_id") return "LinkedIn";
  if (id === "ttclid") return "TikTok";
  return "Google Ads";
}

interface SessionRow {
  session_id: string; visitor_id: string | null; anon_id: string | null;
  source_name: string | null; channel: string | null; referrer_host: string | null;
  utm_campaign: string | null; utm_medium: string | null; entry_path: string | null; started_at: string;
}

/** user_id → Origin, for every profile that has signup_attribution. Empty if the column doesn't exist yet. */
export async function loadOrigins(sb: SupabaseClient): Promise<Map<string, Origin>> {
  const out = new Map<string, Origin>();
  const rows: { user_id: string; signup_attribution: Stored }[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await sb.from("profiles").select("user_id,signup_attribution")
      .not("signup_attribution", "is", null).range(from, from + 999);
    // Before migration 0071 runs the column is missing: show no origins rather than failing the user list.
    if (error) return out;
    rows.push(...((data ?? []) as typeof rows));
    if (!data || data.length < 1000) break;
  }
  if (!rows.length) return out;

  const sids = [...new Set(rows.map(r => r.signup_attribution?.sid).filter((v): v is string => !!v))];
  const sessions = new Map<string, SessionRow>();
  for (let i = 0; i < sids.length; i += 200) {
    const { data } = await sb.from("web_sessions")
      .select("session_id,visitor_id,anon_id,source_name,channel,referrer_host,utm_campaign,utm_medium,entry_path,started_at")
      .in("session_id", sids.slice(i, i + 200));
    (data as SessionRow[] | null)?.forEach(s => sessions.set(s.session_id, s));
  }

  for (const { user_id, signup_attribution: a } of rows) {
    if (!a || typeof a !== "object") continue;
    const s = a.sid ? sessions.get(a.sid) : undefined;
    if (s) {
      out.set(user_id, {
        source: s.source_name || "Direct",
        channel: s.channel || "direct",
        via: "site",
        campaign: s.utm_campaign ?? undefined, medium: s.utm_medium ?? undefined,
        referrerHost: s.referrer_host ?? undefined,
        landing: s.entry_path ?? undefined,
        visitorKey: s.visitor_id ?? s.anon_id ?? undefined,
        visitorPersistent: !!s.visitor_id,
        at: s.started_at,
      });
    } else if (a.sid) {
      // Came through the site but that session isn't stored (no consent banner
      // answer yet, or the collector was down): the site itself is the source.
      out.set(user_id, { source: "preciprocal.com", channel: "direct", via: "site", visitorKey: a.vid, visitorPersistent: !!a.vid, at: a.at });
    } else {
      out.set(user_id, fromApp(a));
    }
  }
  return out;
}
