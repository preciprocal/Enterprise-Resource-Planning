// app/api/admin/route.ts
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { initializeApp, getApps, cert, App } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import Stripe from "stripe";

// ─── Firebase Admin ───────────────────────────────────────────────────────────

function getAdminApp(): App {
  const existing = getApps().find(a => a.name === "adm-server");
  if (existing) return existing;
  return initializeApp({
    credential: cert({
      projectId:   process.env.FIREBASE_ADMIN_PROJECT_ID,
      clientEmail: process.env.FIREBASE_ADMIN_CLIENT_EMAIL,
      privateKey:  process.env.FIREBASE_ADMIN_PRIVATE_KEY?.replace(/\\n/g, "\n"),
    }),
  }, "adm-server");
}

const getDb = () => getFirestore(getAdminApp());

// ─── Stripe ───────────────────────────────────────────────────────────────────

function getStripe() {
  return new Stripe(process.env.STRIPE_SECRET_KEY ?? "", {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    apiVersion: "2024-04-10" as any,
  });
}

// ─── Auth ─────────────────────────────────────────────────────────────────────

function isAuthorised(req: NextRequest): boolean {
  const secret = process.env.ADMIN_SECRET;
  if (!secret) return process.env.NODE_ENV !== "production";
  return req.headers.get("x-admin-secret") === secret;
}

// ─── GET — list users ─────────────────────────────────────────────────────────

export async function GET(req: NextRequest) {
  if (!isAuthorised(req)) return NextResponse.json({ error: "Unauthorised" }, { status: 401 });

  const action = req.nextUrl.searchParams.get("action") ?? "users";

  // ── users ──────────────────────────────────────────────────────────────────
  if (action === "users") {
    try {
      const snap  = await getDb().collection("users").get();
      const users = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      return NextResponse.json({ users });
    } catch (err) {
      return NextResponse.json({ error: (err as Error).message }, { status: 500 });
    }
  }

  // ── analytics — fetch real behavioural data from Firestore ─────────────────
  if (action === "analytics") {
    try {
      const db = getDb();

      // Run all collection fetches in parallel
      const [interviewsSnap, feedbackSnap, resumesSnap, transcriptsSnap] = await Promise.all([
        db.collection("interviews").orderBy("createdAt", "desc").get(),
        db.collection("feedback").orderBy("createdAt", "desc").get(),
        db.collection("resumes").orderBy("createdAt", "desc").get(),
        db.collection("transcripts").orderBy("createdAt", "desc").get(),
      ]);

      const interviews  = interviewsSnap.docs.map(d  => ({ id: d.id,  ...d.data() }));
      const feedbacks   = feedbackSnap.docs.map(d    => ({ id: d.id,  ...d.data() }));
      const resumes     = resumesSnap.docs.map(d     => ({ id: d.id,  ...d.data() }));
      const transcripts = transcriptsSnap.docs.map(d => ({ id: d.id,  ...d.data() }));

      return NextResponse.json({ interviews, feedbacks, resumes, transcripts });
    } catch (err) {
      return NextResponse.json({ error: (err as Error).message }, { status: 500 });
    }
  }

  return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 });
}

// ─── POST — multiplex actions ─────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  if (!isAuthorised(req)) return NextResponse.json({ error: "Unauthorised" }, { status: 401 });

  let body: Record<string, unknown>;
  try { body = await req.json() as Record<string, unknown>; }
  catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }

  const action = (body.action as string) ?? "update";
  const id     = body.id as string;
  if (!id) return NextResponse.json({ error: "Missing user id" }, { status: 400 });

  // ── 1. Plain Firestore update ──────────────────────────────────────────────
  if (action === "update") {
    const data = body.data as Record<string, unknown>;
    try {
      await getDb().collection("users").doc(id).update({ ...data, updatedAt: new Date().toISOString() });
      return NextResponse.json({ success: true });
    } catch (err) {
      return NextResponse.json({ error: (err as Error).message }, { status: 500 });
    }
  }

  // ── 2. Stripe plan / subscription update ──────────────────────────────────
  if (action === "stripe_update") {
    const sd = body.stripeData as {
      priceId?: string; plan?: string;
      periodStart?: string; periodEnd?: string;
      trialEnd?: string; cancelAtPeriodEnd?: boolean;
    };

    try {
      const stripe  = getStripe();
      const userDoc = await getDb().collection("users").doc(id).get();
      if (!userDoc.exists) return NextResponse.json({ error: "User not found" }, { status: 404 });

      const userData = userDoc.data() as Record<string, unknown>;
      const sub      = (userData.subscription ?? {}) as Record<string, unknown>;
      const subId    = sub.stripeSubscriptionId as string | undefined;

      let updatedSub: Record<string, unknown> = {};

      if (subId && sd.priceId) {
        const existing = await stripe.subscriptions.retrieve(subId);
        const itemId   = existing.items.data[0]?.id;

        const updateParams: Stripe.SubscriptionUpdateParams = {
          items: [{ id: itemId, price: sd.priceId }],
          proration_behavior: "always_invoice",
        };

        if (sd.trialEnd)                   updateParams.trial_end           = Math.floor(new Date(sd.trialEnd).getTime() / 1000);
        if (sd.cancelAtPeriodEnd !== undefined) updateParams.cancel_at_period_end = sd.cancelAtPeriodEnd;

        const updated = await stripe.subscriptions.update(subId, updateParams);

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const u = updated as any;
        updatedSub = {
          stripeSubscriptionId: u.id,
          stripeCustomerId:     u.customer as string,
          plan:                 sd.plan ?? sub.plan,
          status:               u.status,
          currentPeriodStart:   new Date((u.current_period_start ?? u.billing_cycle_anchor ?? 0) * 1000).toISOString(),
          currentPeriodEnd:     new Date((u.current_period_end   ?? 0) * 1000).toISOString(),
        };

        if (sd.periodStart) updatedSub.currentPeriodStart = new Date(sd.periodStart).toISOString();
        if (sd.periodEnd)   updatedSub.currentPeriodEnd   = new Date(sd.periodEnd).toISOString();
        if (sd.trialEnd)    updatedSub.trialEndsAt        = new Date(sd.trialEnd).toISOString();

      } else if (sd.plan === "free" && subId) {
        const updated = await stripe.subscriptions.update(subId, { cancel_at_period_end: true });
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const upd = updated as any;
        updatedSub = {
          plan:               "free",
          status:             upd.status,
          cancelAtPeriodEnd:  true,
          canceledAt:         new Date().toISOString(),
          subscriptionEndsAt: new Date((upd.current_period_end ?? 0) * 1000).toISOString(),
        };
      } else if (sd.priceId && sd.priceId !== "__free__") {
        // ── No existing subscription: create one in Stripe from scratch ──────
        const userData2 = userDoc.data() as Record<string, unknown>;
        const userEmail = userData2.email as string | undefined;
        const userName  = userData2.name  as string | undefined;

        // Step 1: get or create a Stripe customer
        let custId = sub.stripeCustomerId as string | undefined;
        if (!custId) {
          const customer = await stripe.customers.create({
            email:    userEmail,
            name:     userName,
            metadata: { firebaseUid: id },
          });
          custId = customer.id;
        }

        // Step 2: create the subscription
        const createParams: Record<string, unknown> = {
          customer: custId,
          items:    [{ price: sd.priceId }],
          payment_behavior: "default_incomplete",
          expand: ["latest_invoice.payment_intent"],
        };
        if (sd.trialEnd)          createParams.trial_end          = Math.floor(new Date(sd.trialEnd).getTime() / 1000);
        if (sd.cancelAtPeriodEnd) createParams.cancel_at_period_end = true;

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const created = await (stripe.subscriptions.create as any)(createParams);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const c = created as any;

        updatedSub = {
          stripeCustomerId:     custId,
          stripeSubscriptionId: c.id,
          plan:                 sd.plan ?? sub.plan,
          status:               c.status,
          currentPeriodStart:   new Date((c.current_period_start ?? c.billing_cycle_anchor ?? 0) * 1000).toISOString(),
          currentPeriodEnd:     new Date((c.current_period_end   ?? 0) * 1000).toISOString(),
        };
        if (sd.trialEnd) updatedSub.trialEndsAt = new Date(sd.trialEnd).toISOString();

      } else {
        // Free plan or no priceId — Firebase only
        updatedSub = { plan: sd.plan ?? sub.plan };
      }

      await getDb().collection("users").doc(id).update({
        subscription: { ...sub, ...updatedSub },
        updatedAt: new Date().toISOString(),
      });

      return NextResponse.json({ success: true, subscription: updatedSub });

    } catch (err) {
      console.error("❌ stripe_update error:", err);
      return NextResponse.json({ error: (err as Error).message }, { status: 500 });
    }
  }

  // ── 3. Apply coupon ───────────────────────────────────────────────────────
  if (action === "apply_coupon") {
    const couponCode = body.couponCode as string;
    if (!couponCode) return NextResponse.json({ error: "Missing couponCode" }, { status: 400 });

    try {
      const stripe  = getStripe();
      const userDoc = await getDb().collection("users").doc(id).get();
      const sub     = ((userDoc.data() as Record<string, unknown>)?.subscription ?? {}) as Record<string, unknown>;
      const custId  = sub.stripeCustomerId as string | undefined;
      const subId   = sub.stripeSubscriptionId as string | undefined;

      if (!custId) return NextResponse.json({ error: "No Stripe customer ID on this user" }, { status: 400 });

      let couponId = couponCode;
      try {
        const promoCodes = await stripe.promotionCodes.list({ code: couponCode, active: true, limit: 1 });
        if (promoCodes.data.length > 0) {
          // coupon field is string (coupon ID) in Stripe v17+ SDK types
          const promo = promoCodes.data[0];
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const couponField = (promo as any).coupon;
          couponId = typeof couponField === "object" && couponField?.id
            ? (couponField.id as string)
            : typeof couponField === "string"
              ? couponField
              : couponCode;
        }
      } catch { /* fall through — use input directly as coupon ID */ }

      if (subId) {
        // Use discounts array (Stripe v17+); fall back via cast for older SDK types
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await stripe.subscriptions.update(subId, { discounts: [{ coupon: couponId }] } as any);
      } else {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await (stripe.customers.update as any)(custId, { coupon: couponId });
      }

      await getDb().collection("users").doc(id).update({
        "subscription.lastAppliedCoupon":   couponCode,
        "subscription.lastCouponAppliedAt": new Date().toISOString(),
        updatedAt:                          new Date().toISOString(),
      });

      return NextResponse.json({ success: true, applied: couponCode });

    } catch (err) {
      console.error("❌ apply_coupon error:", err);
      return NextResponse.json({ error: (err as Error).message }, { status: 500 });
    }
  }

  // ── 4. Contact user via email ─────────────────────────────────────────────
  if (action === "contact_email") {
    const { subject, body: emailBody, toEmail, toName } = body as {
      subject: string; body: string; toEmail: string; toName?: string;
    };
    if (!subject || !emailBody || !toEmail) {
      return NextResponse.json({ error: "Missing subject, body, or toEmail" }, { status: 400 });
    }

    const fromEmail = process.env.ADMIN_FROM_EMAIL ?? "support@preciprocal.com";
    const resendKey = process.env.RESEND_API_KEY;

    try {
      if (resendKey) {
        const res = await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: { "Authorization": `Bearer ${resendKey}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            from:    fromEmail,
            to:      [toEmail],
            subject,
            html:    `<p>${emailBody.replace(/\n/g, "<br/>")}</p><hr/><small style="color:#9ca3af">Sent from Preciprocal Admin</small>`,
          }),
        });
        if (!res.ok) {
          const errBody = await res.text();
          throw new Error(`Resend error: ${errBody}`);
        }
      } else {
        console.log("📧 [DRAFT — no RESEND_API_KEY]\nTo:", toEmail, "\nSubject:", subject, "\nBody:", emailBody);
      }

      await getDb().collection("users").doc(id).update({
        lastContactedAt:    new Date().toISOString(),
        lastContactSubject: subject,
        lastContactSentBy:  fromEmail,
        updatedAt:          new Date().toISOString(),
      });

      return NextResponse.json({ success: true, sent: !!resendKey, draft: !resendKey });

    } catch (err) {
      console.error("❌ contact_email error:", err);
      return NextResponse.json({ error: (err as Error).message }, { status: 500 });
    }
  }

  return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 });
}