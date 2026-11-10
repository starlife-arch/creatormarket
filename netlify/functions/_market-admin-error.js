const { json } = require("./_market-auth");

function adminFailure(error, fallback) {
  const rawCode = error && error.code;
  const code = String(rawCode || "UNKNOWN");
  const message = String(error?.message || "");
  console.error("Market admin backend failure:", code, message, error?.stack || "");

  if (message.includes("FIREBASE_SERVICE_ACCOUNT") || message.includes("MARKET_SESSION_SECRET")) {
    return json(503, { error: "Market backend configuration is incomplete. Check the Firebase service account and Market session secret in Netlify." });
  }
  if (["7", "permission-denied"].includes(code)) {
    return json(503, { error: "Market's Firebase service account does not have the required Firestore permissions. Check its Firebase IAM access." });
  }
  if (["9", "failed-precondition"].includes(code)) {
    return json(503, { error: "Firestore rejected this query because a required index is missing. Deploy the Market Firestore indexes." });
  }
  if (["16", "unauthenticated"].includes(code)) {
    return json(503, { error: "Market's Firebase service account credentials were rejected. Check FIREBASE_SERVICE_ACCOUNT in Netlify." });
  }
  if (["14", "unavailable", "deadline-exceeded"].includes(code)) {
    return json(503, { error: "Firestore is temporarily unavailable. Please retry shortly." });
  }
  return json(500, { error: fallback });
}

module.exports = { adminFailure };
