const {
  getAdmin, verifySession, readCookie, json
} = require("./_market-auth");

function getMarketUser(event) {
  const token = readCookie(event, "dv_market_session");
  const session = verifySession(token);
  if (!session) return { error: json(401, { error: "Sign in to Creator Market first." }) };
  return { uid: session.sub };
}

async function loadEligibleUser(event) {
  const auth = getMarketUser(event);
  if (auth.error) return auth;
  const admin = getAdmin();
  const snap = await admin.firestore().collection("users").doc(auth.uid).get();
  if (!snap.exists) return { error: json(403, { error: "Your DateVault account could not be verified." }) };
  const profile = snap.data() || {};
  if (profile.banned === true || profile.suspended === true || profile.accountSuspended === true ||
      ["rejected", "suspended"].includes(profile.status)) {
    return { error: json(403, { error: "This account cannot access Creator Market." }) };
  }
  if (profile.marketAgeVerified !== true) {
    return { error: json(403, { error: "Complete the separate 18+ verification before accessing creator content." }), ageVerificationRequired: true };
  }
  return { uid: auth.uid, profile, admin };
}

function cleanText(value, max) {
  return typeof value === "string" ? value.trim().replace(/\s+/g, " ").slice(0, max) : "";
}

function validUsername(value) {
  return /^[a-z0-9](?:[a-z0-9_]{1,28}[a-z0-9])?$/.test(value);
}

function isAdmin(profile = {}) {
  return profile.role === "admin" || profile.isAdmin === true;
}

module.exports = { getMarketUser, loadEligibleUser, cleanText, validUsername, isAdmin };
