// lib/email-shell.ts
// The Dashboard's branded email shell, so an email sent from the ERP looks
// exactly like the ones the product sends (welcome, coaching, billing).
//
// A port of the Dashboard's lib/email/layout.ts (renderEmail / renderText).
// The two repos cannot share code, so this is a copy: if the Dashboard's
// layout changes, change it here too. The load-bearing rules from that file
// apply unchanged and are why the markup looks the way it does:
//   1. the webfont @import sits alone in its own <style> block (Gmail drops
//      the whole block that contains it)
//   2. every background is painted twice, as a colour and a flat gradient
//      (Gmail mobile repaints colours but leaves gradients alone)
//   3. text colours are pinned alongside the backgrounds
//   4. output is pure ASCII, non-ASCII as numeric entities
//   5. tables only, for Outlook
//
// Pure: no secrets, no I/O. The browser uses it for the preview, so the
// preview is exactly what is sent.

const SITE = { name: "Preciprocal", app: "https://app.preciprocal.com" } as const;

// ─── Link tagging ────────────────────────────────────────────────────────────
// utm_campaign = email type on app links, so the Dashboard's ActivityTracker
// attributes what someone does after a click to the email that caused it.
// /api/ links (unsubscribe) are left alone: their signature covers the query.

function tagUrl(url: string, campaign: string): string {
  if (url.includes("/api/") || url.includes("utm_source=")) return url;
  const [base, hash] = url.split("#");
  const tagged = `${base}${base.includes("?") ? "&" : "?"}utm_source=email&utm_medium=email&utm_campaign=${encodeURIComponent(campaign)}`;
  return hash !== undefined ? `${tagged}#${hash}` : tagged;
}

const APP_ORIGINS = "https:\\/\\/app\\.preciprocal\\.com|https:\\/\\/preciprocal\\.com";

function tagHtmlLinks(html: string, campaign?: string): string {
  if (!campaign) return html;
  return html.replace(new RegExp(`href="((?:${APP_ORIGINS})[^"]*)"`, "g"), (_m, url: string) => `href="${tagUrl(url, campaign)}"`);
}

export function tagTextLinks(text: string, campaign?: string): string {
  if (!campaign) return text;
  return text.replace(new RegExp(`((?:${APP_ORIGINS})[^\\s]*)`, "g"), (url: string) => tagUrl(url, campaign));
}

// ─── Palette, matched to the app ─────────────────────────────────────────────
const C = {
  base: "#05070c", surface: "#0d1117", fg: "#ffffff", muted: "#94a3b8", dim: "#64748b",
  hairline: "#1e2532", accent: "#818cf8", ctaBg: "#6366f1", ctaText: "#ffffff",
} as const;
const SANS = "'Inter',-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif";
const DISPLAY = "'Space Grotesk','Helvetica Neue',Helvetica,Arial,sans-serif";
const MEASURE = "660px";
const LOGO_URL = `${SITE.app}/logo.png`;

const contentWrap = (inner: string): string => `
  <!--[if mso]><table role="presentation" align="center" cellpadding="0" cellspacing="0" border="0" width="660"><tr><td><![endif]-->
  <table role="presentation" align="center" cellpadding="0" cellspacing="0" border="0" width="100%" style="width:100%;max-width:${MEASURE};">
    <tr><td align="left">${inner}</td></tr>
  </table>
  <!--[if mso]></td></tr></table><![endif]-->`;

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

/** Rule 4: every non-ASCII character becomes a numeric entity. */
const asciiEntities = (v: string) => v.replace(/[^\x00-\x7f]/gu, c => `&#${c.codePointAt(0)};`);

// ─── Message body ────────────────────────────────────────────────────────────

const URL_RE = /https?:\/\/[^\s<>"')]+[^\s<>"').,;:!?]/g;

/**
 * Plain text as the admin typed it, to escaped paragraphs with links made
 * clickable. Blank lines separate paragraphs; single newlines are kept.
 */
export function textToParagraphs(text: string): string[] {
  return text.trim().split(/\n{2,}/).map(p => p.split("\n").map(line => {
    let out = "", last = 0;
    for (const m of line.matchAll(URL_RE)) {
      out += escapeHtml(line.slice(last, m.index));
      out += `<a href="${escapeHtml(m[0])}" class="t-accent" style="color:${C.accent};text-decoration:underline;">${escapeHtml(m[0])}</a>`;
      last = (m.index ?? 0) + m[0].length;
    }
    return out + escapeHtml(line.slice(last));
  }).join("<br />")).filter(Boolean);
}

// ─── Shell ───────────────────────────────────────────────────────────────────

export interface ShellOptions {
  preheader: string;
  eyebrow: string;
  heading: string;
  /** Already-escaped HTML paragraphs (see textToParagraphs). */
  paragraphs: string[];
  /** Buttons, in order. The first is the filled primary; the rest are outlined. */
  ctas?: { label: string; url: string }[];
  signature: { name: string; title?: string; email?: string };
  footerNote: string;
  /** e.g. the unsubscribe link. */
  footerExtraHtml?: string;
  /** Email type, for link tagging. */
  campaign?: string;
}

const signatureHtml = (sig: ShellOptions["signature"]): string => {
  const lines = [
    `<div class="t-fg" style="font-family:${SANS};font-size:15px;font-weight:700;line-height:1.5;color:${C.fg};">${escapeHtml(sig.name)}</div>`,
    sig.title ? `<div class="t-muted" style="margin:2px 0 0 0;font-family:${SANS};font-size:15px;line-height:1.5;color:${C.muted};">${escapeHtml(sig.title)}</div>` : "",
    sig.email ? `<div style="margin:6px 0 0 0;font-family:${SANS};font-size:15px;line-height:1.5;"><a href="mailto:${escapeHtml(sig.email)}" class="t-accent" style="color:${C.accent};text-decoration:none;">${escapeHtml(sig.email)}</a></div>` : "",
  ].join("");
  return `
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin:30px 0 0 0;">
      <tr><td style="padding:0 0 18px 0;">
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
          <tr><td height="1" bgcolor="${C.hairline}" style="height:1px;line-height:1px;font-size:0;">&nbsp;</td></tr>
        </table>
      </td></tr>
      <tr><td>${lines}</td></tr>
    </table>`;
};

// Stacked, one per row, rather than side by side: two pills in one row wrap
// unpredictably on phones and Outlook cannot be told to wrap them at all.
const ctaHtml = (ctas: ShellOptions["ctas"]): string => {
  if (!ctas?.length) return "";
  const rows = ctas.map((cta, i) => {
    const cell = i === 0
      ? `<td align="center" bgcolor="${C.ctaBg}" class="cta-td" style="border-radius:999px;background-color:${C.ctaBg};background-image:linear-gradient(135deg,${C.ctaBg},#a855f7);">
                <a href="${escapeHtml(cta.url)}" class="cta-a" style="display:inline-block;padding:15px 34px;font-family:${SANS};font-size:15px;font-weight:600;line-height:1;color:${C.ctaText};text-decoration:none;border-radius:999px;">${escapeHtml(cta.label)}</a>
              </td>`
      : `<td align="center" style="border-radius:999px;border:1px solid ${C.accent};">
                <a href="${escapeHtml(cta.url)}" class="t-accent" style="display:inline-block;padding:13px 32px;font-family:${SANS};font-size:15px;font-weight:600;line-height:1;color:${C.accent};text-decoration:none;border-radius:999px;">${escapeHtml(cta.label)}</a>
              </td>`;
    return `
      <tr>
        <td align="center" style="padding:${i ? 12 : 0}px 0 0 0;">
          <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="border-collapse:separate;">
            <tr>
              ${cell}
            </tr>
          </table>
        </td>
      </tr>`;
  }).join("");
  return `
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin:26px 0 6px 0;">${rows}
    </table>`;
};

export function renderShell(o: ShellOptions): string {
  const paragraphs = o.paragraphs
    .map(p => `<p class="t-muted" style="margin:0 0 18px 0;font-family:${SANS};font-size:16px;line-height:1.65;color:${C.muted};">${p}</p>`)
    .join("");

  const html = `<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd">
<html xmlns="http://www.w3.org/1999/xhtml" lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta http-equiv="X-UA-Compatible" content="IE=edge" />
  <title>${escapeHtml(o.heading)}</title>
  <meta name="color-scheme" content="dark" />
  <meta name="supported-color-schemes" content="dark" />
  <style type="text/css">
    @import url('https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@500;600;700&family=Inter:wght@400;500;600;700&display=swap');
  </style>
  <style type="text/css">
    :root { color-scheme: dark; supported-color-schemes: dark; }
    body { margin:0 !important; padding:0 !important; width:100% !important; background-color:${C.base}; background-image:linear-gradient(${C.base},${C.base}); }
    a { color:${C.accent}; }
    a[x-apple-data-detectors] { color:inherit !important; text-decoration:none !important; font-size:inherit !important; font-family:inherit !important; font-weight:inherit !important; line-height:inherit !important; }
    .bg-base { background-color:${C.base}; background-image:linear-gradient(${C.base},${C.base}); }
    .bg-surface { background-color:${C.surface}; background-image:linear-gradient(${C.surface},${C.surface}); }
    .t-fg { color:${C.fg} !important; }
    .t-accent { color:${C.accent} !important; }
    .t-muted { color:${C.muted} !important; }
    .t-dim { color:${C.dim} !important; }
    .cta-td { background-color:${C.ctaBg}; background-image:linear-gradient(135deg,${C.ctaBg},#a855f7); }
    .cta-a { color:${C.ctaText} !important; }
    @media (prefers-color-scheme: dark) {
      .bg-base { background-color:${C.base}; background-image:linear-gradient(${C.base},${C.base}); }
      .bg-surface { background-color:${C.surface}; background-image:linear-gradient(${C.surface},${C.surface}); }
      .t-fg { color:${C.fg} !important; }
      .t-accent { color:${C.accent} !important; }
      .t-muted { color:${C.muted} !important; }
      .t-dim { color:${C.dim} !important; }
      .cta-td { background-color:${C.ctaBg}; background-image:linear-gradient(135deg,${C.ctaBg},#a855f7); }
      .cta-a { color:${C.ctaText} !important; }
    }
    [data-ogsc] .t-fg { color:${C.fg} !important; }
    [data-ogsc] .t-accent { color:${C.accent} !important; }
    [data-ogsc] .t-muted { color:${C.muted} !important; }
    [data-ogsc] .t-dim { color:${C.dim} !important; }
    [data-ogsc] .cta-a { color:${C.ctaText} !important; }
    [data-ogsb] .bg-base { background-color:${C.base}; background-image:linear-gradient(${C.base},${C.base}); }
    [data-ogsb] .bg-surface { background-color:${C.surface}; background-image:linear-gradient(${C.surface},${C.surface}); }
    [data-ogsb] .cta-td { background-color:${C.ctaBg}; background-image:linear-gradient(135deg,${C.ctaBg},#a855f7); }
    @media only screen and (max-width:620px) {
      .shell { width:100% !important; max-width:100% !important; }
      .pad { padding-left:24px !important; padding-right:24px !important; }
      .h1 { font-size:28px !important; }
    }
  </style>
</head>
<body bgcolor="${C.base}" class="bg-base" style="margin:0;padding:0;background-color:${C.base};background-image:linear-gradient(${C.base},${C.base});">
  <div style="display:none;max-height:0;overflow:hidden;mso-hide:all;font-size:1px;line-height:1px;color:${C.base};opacity:0;">${escapeHtml(o.preheader)}${"&nbsp;".repeat(40)}</div>
  <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" height="100%" bgcolor="${C.base}" class="bg-base" style="background-color:${C.base};background-image:linear-gradient(${C.base},${C.base});">
    <tr>
      <td align="center" valign="top" bgcolor="${C.base}" class="bg-base" style="padding:32px 12px;background-color:${C.base};background-image:linear-gradient(${C.base},${C.base});">
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" class="shell bg-surface" bgcolor="${C.surface}" style="width:100%;max-width:100%;border-collapse:separate;background-color:${C.surface};background-image:linear-gradient(${C.surface},${C.surface});border:1px solid ${C.hairline};border-radius:18px;overflow:hidden;">
          <tr>
            <td height="3" bgcolor="${C.ctaBg}" style="height:3px;line-height:3px;font-size:0;background-color:${C.ctaBg};background-image:linear-gradient(90deg,${C.surface},${C.ctaBg},#a855f7,${C.surface});">&nbsp;</td>
          </tr>
          <tr>
            <td align="center" class="pad" style="padding:30px 40px 0 40px;">
              <img src="${LOGO_URL}" width="96" height="96" alt="${SITE.name}" style="display:block;width:96px;height:96px;border:0;outline:none;text-decoration:none;" />
            </td>
          </tr>
          <tr>
            <td align="center" class="pad" style="padding:0 40px;">
              <div class="t-fg" style="font-family:${SANS};font-size:22px;font-weight:700;line-height:1.2;letter-spacing:-0.2px;color:${C.fg};">${SITE.name}</div>
            </td>
          </tr>
          <tr>
            <td align="center" style="padding:12px 40px 0 40px;">
              <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="150">
                <tr><td height="1" bgcolor="${C.ctaBg}" style="height:1px;line-height:1px;font-size:0;background-color:${C.ctaBg};background-image:linear-gradient(90deg,${C.surface},${C.accent},${C.surface});">&nbsp;</td></tr>
              </table>
            </td>
          </tr>
          <tr>
            <td class="pad" style="padding:40px 32px 0 32px;">
              ${contentWrap(`
              <div class="t-accent" style="margin:0 0 14px 0;font-family:${SANS};font-size:11px;font-weight:600;line-height:1.4;letter-spacing:3.2px;text-transform:uppercase;color:${C.accent};">${escapeHtml(o.eyebrow)}</div>
              <h1 class="h1 t-fg" style="margin:0 0 22px 0;font-family:${DISPLAY};font-size:31px;font-weight:700;line-height:1.15;letter-spacing:-0.6px;color:${C.fg};">${escapeHtml(o.heading)}</h1>
              ${paragraphs}
              ${ctaHtml(o.ctas)}
              ${signatureHtml(o.signature)}
              `)}
            </td>
          </tr>
          <tr>
            <td class="pad" style="padding:38px 32px 0 32px;">
              ${contentWrap(`
              <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
                <tr><td height="1" bgcolor="${C.hairline}" style="height:1px;line-height:1px;font-size:0;">&nbsp;</td></tr>
              </table>`)}
            </td>
          </tr>
          <tr>
            <td class="pad" style="padding:22px 32px 40px 32px;">
              ${contentWrap(`
              <div class="t-muted" style="margin:0 0 10px 0;font-family:${SANS};font-size:12px;line-height:1.6;letter-spacing:0.3px;color:${C.muted};">Resumes &middot; Mock interviews &middot; Cover letters &middot; Job tracking</div>
              <div class="t-muted" style="font-family:${SANS};font-size:12px;line-height:1.6;color:${C.muted};">
                <a href="${SITE.app}" class="t-accent" style="color:${C.accent};text-decoration:none;">app.preciprocal.com</a>
                &nbsp;&middot;&nbsp;
                <a href="mailto:support@preciprocal.com" class="t-accent" style="color:${C.accent};text-decoration:none;">support@preciprocal.com</a>
              </div>
              ${o.footerExtraHtml ?? ""}`)}
            </td>
          </tr>
        </table>
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" class="shell" style="width:100%;max-width:100%;">
          <tr>
            <td align="center" style="padding:18px 24px 0 24px;">
              <div class="t-dim" style="font-family:${SANS};font-size:11px;line-height:1.6;color:${C.dim};">${escapeHtml(o.footerNote)}</div>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
  return asciiEntities(tagHtmlLinks(html, o.campaign));
}

/** Plain-text part. Never optional: HTML-only mail scores worse with spam filters. */
export function renderShellText(o: {
  heading: string; body: string; ctas?: { label: string; url: string }[];
  signature: { name: string; title?: string; email?: string };
  footerNote: string; footerExtra?: string; campaign?: string;
}): string {
  const parts = [o.heading, "", o.body.trim(), ""];
  for (const c of o.ctas ?? []) parts.push(`${c.label}: ${c.url}`);
  if (o.ctas?.length) parts.push("");
  parts.push(o.signature.name);
  if (o.signature.title) parts.push(o.signature.title);
  if (o.signature.email) parts.push(o.signature.email);
  parts.push("", `${SITE.app}  |  support@preciprocal.com`, "", o.footerNote);
  if (o.footerExtra) parts.push("", o.footerExtra);
  return tagTextLinks(parts.join("\n"), o.campaign);
}

