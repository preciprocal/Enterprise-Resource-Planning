// app/api/cloudflare/route.ts
// ─────────────────────────────────────────────────────────────────────────────
// Cloudflare Analytics proxy with filters.
//
// Query params:
//   ?days=N            ← 1, 7, 30, or 90 (default 7)
//   ?country=US        ← ISO-2 code; "all" or omitted = no filter
//   ?device=mobile     ← desktop | mobile | tablet | other | all
//
// Important: httpRequests1dGroups doesn't accept a `clientDeviceType` filter,
// so device filtering is done on the `httpRequestsAdaptiveGroups` dataset
// instead — that's the dataset Cloudflare exposes those filters on.
//
// To keep one consistent payload:
//   - When NO device filter is set → use httpRequests1dGroups (richer metrics
//     including uniques, pageViews, breakdowns).
//   - When device filter IS set → use httpRequestsAdaptiveGroups (no uniques,
//     no pageViews, no breakdowns; just visits + bytes + requests).
//
// The client gets the same shape either way, with nulls in the slots that
// aren't available for the active dataset, plus an `adaptive: boolean` flag.
// ─────────────────────────────────────────────────────────────────────────────

export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";

const CF_GRAPHQL = "https://api.cloudflare.com/client/v4/graphql";

function isAuthorised(req: NextRequest) {
  const secret = process.env.ADMIN_SECRET;
  if (!secret) return process.env.NODE_ENV !== "production";
  return req.headers.get("x-admin-secret") === secret;
}

function dateRange(days: number) {
  const end = new Date();
  const start = new Date();
  start.setDate(start.getDate() - days);
  const fmt = (d: Date) => d.toISOString().slice(0, 10);
  return { since: fmt(start), until: fmt(end) };
}

// Cloudflare's device type values are lowercase: "desktop", "mobile", "tablet", "other"
const VALID_DEVICES = new Set(["desktop", "mobile", "tablet", "other"]);

export async function GET(req: NextRequest) {
  if (!isAuthorised(req)) {
    return NextResponse.json({ error: "Unauthorised" }, { status: 401 });
  }

  const zoneId = process.env.CLOUDFLARE_ZONE_ID;
  const token  = process.env.CLOUDFLARE_API_TOKEN;
  if (!zoneId) return NextResponse.json({ error: "Missing CLOUDFLARE_ZONE_ID in .env"  }, { status: 500 });
  if (!token)  return NextResponse.json({ error: "Missing CLOUDFLARE_API_TOKEN in .env" }, { status: 500 });

  // ── Parse query params ─────────────────────────────────────────────────────
  const daysParam = parseInt(req.nextUrl.searchParams.get("days") ?? "7", 10);
  const days = Number.isFinite(daysParam) && daysParam > 0 && daysParam <= 90 ? daysParam : 7;

  const rawCountry = (req.nextUrl.searchParams.get("country") ?? "").trim().toUpperCase();
  const country = rawCountry && rawCountry !== "ALL" && /^[A-Z]{2}$/.test(rawCountry) ? rawCountry : null;

  const rawDevice = (req.nextUrl.searchParams.get("device") ?? "").trim().toLowerCase();
  const device = rawDevice && rawDevice !== "all" && VALID_DEVICES.has(rawDevice) ? rawDevice : null;

  const { since, until } = dateRange(days);

  // ── Pick dataset based on whether a device filter is requested ────────────
  const useAdaptive = device !== null;

  const query = useAdaptive
    ? buildAdaptiveQuery(country, device)
    : buildDailyQuery(country);

  try {
    const res = await fetch(CF_GRAPHQL, {
      method: "POST",
      headers: { "Authorization": `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        query,
        variables: { zoneTag: zoneId, since, until, days: days + 1, ...(country ? { country } : {}), ...(device ? { device } : {}) },
      }),
    });

    if (!res.ok) {
      const text = await res.text();
      return NextResponse.json(
        { error: `Cloudflare HTTP ${res.status}: ${text.slice(0, 400)}` },
        { status: 502 }
      );
    }

    const json = await res.json() as CFGraphQLResponse;
    if (json.errors?.length) {
      return NextResponse.json(
        { error: `Cloudflare GraphQL: ${json.errors.map(e => e.message).join(" · ")}` },
        { status: 502 }
      );
    }

    const zone = json.data?.viewer?.zones?.[0];
    if (!zone) {
      return NextResponse.json(
        { error: "No zone returned — check CLOUDFLARE_ZONE_ID and token zone permissions" },
        { status: 502 }
      );
    }

    // ── Flatten into a uniform shape ─────────────────────────────────────────
    if (useAdaptive) {
      // Adaptive dataset: limited metrics. No uniques, no pageViews, no breakdowns.
      const daily = (zone.daily ?? []).map(d => ({
        date: d.dimensions.date,
        sum: {
          visits:      d.sum?.visits ?? 0,
          pageViews:   null,
          requests:    null,
          bytes:       d.sum?.edgeResponseBytes ?? 0,
          cachedBytes: null,
          threats:     null,
        },
      }));
      const totals = zone.totals?.[0];
      return NextResponse.json({
        adaptive: true,
        daily,
        totals: totals ? {
          uniqueVisitors: null,
          pageViews:      null,
          requests:       null,
          bytes:          totals.sum?.edgeResponseBytes ?? 0,
          cachedBytes:    null,
          threats:        null,
          cacheRate:      null,
          visits:         totals.sum?.visits ?? 0,
        } : null,
        countries: [], browsers: [], statuses: [], content: [],
        since, until, days,
        appliedFilters: { country, device },
      }, { headers: { "Cache-Control": "public, s-maxage=300, stale-while-revalidate=600" } });
    }

    // Daily dataset: rich metrics
    const daily = (zone.daily ?? []).map(d => ({
      date: d.dimensions.date,
      sum: {
        visits:      d.uniq?.uniques ?? 0,
        pageViews:   d.sum?.pageViews ?? 0,
        requests:    d.sum?.requests  ?? 0,
        bytes:       d.sum?.bytes     ?? 0,
        cachedBytes: d.sum?.cachedBytes ?? 0,
        threats:     d.sum?.threats   ?? 0,
      },
    }));
    const totals = zone.totals?.[0];

    return NextResponse.json({
      adaptive: false,
      daily,
      totals: totals ? {
        uniqueVisitors: totals.uniq?.uniques ?? 0,
        pageViews:      totals.sum?.pageViews   ?? 0,
        requests:       totals.sum?.requests    ?? 0,
        bytes:          totals.sum?.bytes       ?? 0,
        cachedBytes:    totals.sum?.cachedBytes ?? 0,
        threats:        totals.sum?.threats     ?? 0,
        cacheRate:      (totals.sum?.bytes ?? 0) > 0
                          ? Math.round(((totals.sum?.cachedBytes ?? 0) / (totals.sum?.bytes ?? 1)) * 100)
                          : 0,
      } : null,
      countries: totals?.sum?.countryMap        ?? [],
      browsers:  totals?.sum?.browserMap        ?? [],
      statuses:  totals?.sum?.responseStatusMap ?? [],
      content:   totals?.sum?.contentTypeMap    ?? [],
      since, until, days,
      appliedFilters: { country, device },
    }, { headers: { "Cache-Control": "public, s-maxage=300, stale-while-revalidate=600" } });

  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}

// ─── Query builders ──────────────────────────────────────────────────────────

function buildDailyQuery(country: string | null): string {
  // Optional country filter — clientCountryName_in expects an array of ISO-2 codes
  const filterParts = ["date_geq: $since", "date_leq: $until"];
  if (country) filterParts.push(`clientCountryName_in: [$country]`);
  const filter = `{ ${filterParts.join(", ")} }`;

  const vars = country
    ? `$zoneTag: string!, $since: Date!, $until: Date!, $days: Int!, $country: String!`
    : `$zoneTag: string!, $since: Date!, $until: Date!, $days: Int!`;

  return `
    query ZoneTraffic(${vars}) {
      viewer {
        zones(filter: { zoneTag: $zoneTag }) {

          daily: httpRequests1dGroups(
            limit: $days
            filter: ${filter}
            orderBy: [date_ASC]
          ) {
            dimensions { date }
            sum { requests pageViews bytes cachedBytes threats }
            uniq { uniques }
          }

          totals: httpRequests1dGroups(
            limit: 1
            filter: ${filter}
          ) {
            sum {
              requests pageViews bytes cachedBytes threats
              countryMap        { clientCountryName        requests bytes }
              browserMap        { uaBrowserFamily          pageViews }
              responseStatusMap { edgeResponseStatus       requests }
              contentTypeMap    { edgeResponseContentTypeName requests bytes }
            }
            uniq { uniques }
          }

        }
      }
    }
  `;
}

function buildAdaptiveQuery(country: string | null, device: string): string {
  // Adaptive dataset uses datetime_geq/datetime_leq (with time component),
  // and clientDeviceType / clientCountryName as direct filter fields.
  // The dimension date field is `date` (still works as date string).
  const filterParts = [
    `date_geq: $since`,
    `date_leq: $until`,
    `clientDeviceType: $device`,
  ];
  if (country) filterParts.push(`clientCountryName: $country`);
  const filter = `{ ${filterParts.join(", ")} }`;

  const vars = country
    ? `$zoneTag: string!, $since: Date!, $until: Date!, $days: Int!, $device: String!, $country: String!`
    : `$zoneTag: string!, $since: Date!, $until: Date!, $days: Int!, $device: String!`;

  return `
    query ZoneTrafficAdaptive(${vars}) {
      viewer {
        zones(filter: { zoneTag: $zoneTag }) {

          daily: httpRequestsAdaptiveGroups(
            limit: $days
            filter: ${filter}
            orderBy: [date_ASC]
          ) {
            dimensions { date }
            sum { visits edgeResponseBytes }
          }

          totals: httpRequestsAdaptiveGroups(
            limit: 1
            filter: ${filter}
          ) {
            sum { visits edgeResponseBytes }
          }

        }
      }
    }
  `;
}

// ─── Types for the Cloudflare response (loose) ───────────────────────────────

interface CFGraphQLResponse {
  data?: {
    viewer?: {
      zones?: {
        daily?: {
          dimensions: { date: string };
          sum?: {
            requests?: number; pageViews?: number; bytes?: number;
            cachedBytes?: number; threats?: number;
            visits?: number; edgeResponseBytes?: number;
          };
          uniq?: { uniques?: number };
        }[];
        totals?: {
          sum?: {
            requests?: number; pageViews?: number; bytes?: number;
            cachedBytes?: number; threats?: number;
            visits?: number; edgeResponseBytes?: number;
            countryMap?:        { clientCountryName: string; requests: number; bytes: number }[];
            browserMap?:        { uaBrowserFamily: string; pageViews: number }[];
            responseStatusMap?: { edgeResponseStatus: number; requests: number }[];
            contentTypeMap?:    { edgeResponseContentTypeName: string; requests: number; bytes: number }[];
          };
          uniq?: { uniques?: number };
        }[];
      }[];
    };
  };
  errors?: { message: string; path?: string[] }[];
}