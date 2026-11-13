const { getAdmin, json, parseBody, signSession, sessionCookie, expectedOrigin } = require("./_market-auth");

const FIREBASE_API_KEY = process.env.DATEVAULT_FIREBASE_API_KEY || "AIzaSyAu-jRmUXHvTr63jAiU9EMT4CgHhJdNM70";
const FIREBASE_AUTH_BASE = "https://identitytoolkit.googleapis.com/v1/accounts";

function validCredentials(email, password) {
  return typeof email === "string" && email.length <= 254 &&
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) &&
    typeof password === "string" && password.length >= 8 && password.length <= 128;
}

async function firebasePasswordAuth(mode, email, password) {
  const endpoint = mode === "register" ? "signUp" : "signInWithPassword";
  const response = await fetch(`${FIREBASE_AUTH_BASE}:${endpoint}?key=${encodeURIComponent(FIREBASE_API_KEY)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password, returnSecureToken: true })
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const code = data.error?.message || "AUTH_FAILED";
    const messages = {
      EMAIL_EXISTS: "An account already uses this email. Sign in instead.",
      EMAIL_NOT_FOUND: "No account was found for this email.",
      INVALID_PASSWORD: "The email or password is incorrect.",
      INVALID_LOGIN_CREDENTIALS: "The email or password is incorrect.",
      WEAK_PASSWORD : "Choose a password with at least 8 characters.",
      TOO_MANY_ATTEMPTS_TRY_LATER: "Too many attempts. Please try again later."
    };
    const error = new Error(messages[code] || "Could not authenticate this account.");
    error.status = code === "EMAIL_EXISTS" ? 409 : code === "EMAIL_NOT_FOUND" ? 404 : code === "WEAK_PASSWORD" ? 400 : code === "TOO_MANY_ATTEMPTS_TRY_LATER" ? 429 : 401;
    throw error;
  }
  return data;
}

async function establishMarketSession(idToken, displayName = "") {
  const admin = getAdmin();
  const decoded = await admin.auth().verifyIdToken(idToken);
  const db = admin.firestore();
  const ref = db.collection("users").doc(decoded.uid);
  await db.runTransaction(async tx => {
    const snap = await tx.get(ref);
    if (!snap.exists) {
      const email = decoded.email || "";
      const name = String(displayName || decoded.name || "").trim().slice(0, 80);
      tx.create(ref, {
        uid: decoded.uid,
        email,
        name,
        displayName: name,
        status: "market_only",
        stage: "market_only",
        role: "user",
        banned: false,
        paid: false,
        emailVerified: decoded.email_verified === true,
        profileComplete: false,
        verificationSubmitted: false,
        adminApproved: false,
        hasPaid: false,
        plan: "none",
        subscription: { plan: "none", status: "inactive", billing: null, startDate: null, nextBillingDate: null },
        walletBalance: 0,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        marketAccountCreatedAt: admin.firestore.FieldValue.serverTimestamp()
      });
    }
  });
  const userSnap = await ref.get();
  const profile = userSnap.data() || {};
  if (profile.banned === true || profile.suspended === true || profile.accountSuspended === true || profile.marketBanned === true) {
    const error = new Error("This account is restricted from Creator Market. Contact support if you believe this is an error.");
    error.status = 403;
    throw error;
  }
  return { uid: decoded.uid, cookie: sessionCookie(signSession(decoded.uid)), profile };
}

module.exports = { FIREBASE_API_KEY, expectedOrigin, validCredentials, firebasePasswordAuth, establishMarketSession };
