// lib/logUserEvent.ts
// ─────────────────────────────────────────────────────────────────────────────
// Call this from your main app whenever a user logs in, signs up, or performs
// an action. It writes to the admin `logs` Firestore collection so the admin
// dashboard shows ALL users' activity — not just the admin's.
//
// SETUP:
//   1. Drop this file into your main app at lib/logUserEvent.ts
//   2. Call it after Firebase sign-in (see examples below)
//   3. Make sure NEXT_PUBLIC_ADMIN_API_URL points to your admin API route
//      e.g. in .env.local:  NEXT_PUBLIC_ADMIN_API_URL=https://your-admin-domain.com
// ─────────────────────────────────────────────────────────────────────────────

export type LogEventType = "login" | "signup" | "logout" | "action" | "error";

export interface LogEventPayload {
  userId:     string;
  userName?:  string;
  userEmail?: string;
  type:       LogEventType;
  action?:    string;          // e.g. "resume_analyse", "interview_start"
  path?:      string;          // current page path
  details?:   Record<string, unknown>;
}

/**
 * Logs a user event to the admin activity logs.
 * Fire-and-forget — won't throw, won't block your UI.
 *
 * @param payload  The event data
 * @param idToken  Firebase ID token from `await user.getIdToken()`
 */
export async function logUserEvent(
  payload: LogEventPayload,
  idToken: string,
): Promise<void> {
  try {
    const baseUrl = process.env.NEXT_PUBLIC_ADMIN_API_URL ?? "";
    await fetch(`${baseUrl}/api/admin`, {
      method: "POST",
      headers: {
        "Content-Type":     "application/json",
        "x-firebase-token": idToken,
      },
      body: JSON.stringify({
        action: "write_log",
        log: {
          ...payload,
          // userAgent is auto-detected server-side from the request headers
          // ip, city, country, browser, os, device are all auto-enriched server-side
        },
      }),
    });
  } catch {
    // Logging should never crash the app — silently swallow errors
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// USAGE EXAMPLES
// ─────────────────────────────────────────────────────────────────────────────

/*
// ── 1. Log on Firebase sign-in (works for both email and Google) ──────────────

import { signInWithEmailAndPassword, getAuth } from "firebase/auth";
import { logUserEvent } from "@/lib/logUserEvent";

async function handleSignIn(email: string, password: string) {
  const auth = getAuth();
  const cred = await signInWithEmailAndPassword(auth, email, password);
  const idToken = await cred.user.getIdToken();

  // Fire and forget — don't await
  void logUserEvent({
    userId:     cred.user.uid,
    userName:   cred.user.displayName ?? undefined,
    userEmail:  cred.user.email ?? undefined,
    type:       "login",
  }, idToken);
}


// ── 2. Log on signup ──────────────────────────────────────────────────────────

async function handleSignUp(email: string, password: string, name: string) {
  const auth = getAuth();
  const cred = await createUserWithEmailAndPassword(auth, email, password);
  const idToken = await cred.user.getIdToken();

  void logUserEvent({
    userId:    cred.user.uid,
    userName:  name,
    userEmail: email,
    type:      "signup",
    details:   { provider: "email" },
  }, idToken);
}


// ── 3. Log on Google sign-in ──────────────────────────────────────────────────

async function handleGoogleSignIn() {
  const auth = getAuth();
  const cred = await signInWithPopup(auth, new GoogleAuthProvider());
  const idToken = await cred.user.getIdToken();
  const isNewUser = getAdditionalUserInfo(cred)?.isNewUser;

  void logUserEvent({
    userId:    cred.user.uid,
    userName:  cred.user.displayName ?? undefined,
    userEmail: cred.user.email ?? undefined,
    type:      isNewUser ? "signup" : "login",
    details:   { provider: "google" },
  }, idToken);
}


// ── 4. Log feature usage (e.g. resume upload, interview start) ────────────────

async function handleResumeAnalyse(user: User) {
  const idToken = await user.getIdToken();

  void logUserEvent({
    userId:    user.uid,
    userName:  user.displayName ?? undefined,
    userEmail: user.email ?? undefined,
    type:      "action",
    action:    "resume_analyse",
    path:      "/dashboard/resume",
    details:   { count: 1 },
  }, idToken);

  // ... rest of your feature logic
}


// ── 5. Log on sign-out ────────────────────────────────────────────────────────

async function handleSignOut(user: User) {
  const idToken = await user.getIdToken(); // get token BEFORE sign-out
  void logUserEvent({
    userId:    user.uid,
    userEmail: user.email ?? undefined,
    type:      "logout",
  }, idToken);
  await signOut(getAuth());
}
*/