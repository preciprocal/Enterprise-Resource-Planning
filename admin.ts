// admin.ts  (project root — NOT firebase-admin, this is the client SDK)
//
// Single Firebase client instance for the Admin Dashboard.
// Named "adm-dashboard" so it never collides with any other Firebase app
// in the same process.
//
// Uses experimentalForceLongPolling to replace the gRPC WebChannel with
// standard HTTP long-polling, which eliminates the CORS / GrpcConnection
// errors that appear under Turbopack and Next.js dev-server proxies.
//
// The globalThis guard ensures initializeFirestore is only called once
// even when Next.js hot-reload re-evaluates this module.

import { initializeApp, getApps, FirebaseApp } from "firebase/app";
import {
  initializeFirestore,
  getFirestore,
  Firestore,
  CACHE_SIZE_UNLIMITED,
  collection,
  getDocs,
  doc,
  updateDoc,
} from "firebase/firestore";

// Re-export Firestore operations so components only need one import source.
// Importing directly from "firebase/firestore" alongside this file can cause
// a double-initialisation conflict under Turbopack — always import from "@/admin".
export { collection, getDocs, doc, updateDoc };

const APP_NAME = "adm-dashboard";

const firebaseConfig = {
  apiKey:            process.env.NEXT_PUBLIC_FIREBASE_API_KEY             ?? "",
  authDomain:        process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN         ?? "",
  projectId:         process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID          ?? "",
  storageBucket:     process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET      ?? "",
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID ?? "",
  appId:             process.env.NEXT_PUBLIC_FIREBASE_APP_ID              ?? "",
};

// ─── Singleton app ────────────────────────────────────────────────────────────

function getAdminApp(): FirebaseApp {
  return (
    getApps().find((a) => a.name === APP_NAME) ??
    initializeApp(firebaseConfig, APP_NAME)
  );
}

// ─── Singleton Firestore ──────────────────────────────────────────────────────

const _g = globalThis as typeof globalThis & { __adm_db?: Firestore };

function buildDb(): Firestore {
  if (_g.__adm_db) return _g.__adm_db;
  const app = getAdminApp();
  try {
    _g.__adm_db = initializeFirestore(app, {
      experimentalForceLongPolling: true,
      cacheSizeBytes:               CACHE_SIZE_UNLIMITED,
    });
  } catch {
    // initializeFirestore already called on this app (hot-reload) — reuse it
    _g.__adm_db = getFirestore(app);
  }
  return _g.__adm_db;
}

export const adminDb: Firestore = buildDb();