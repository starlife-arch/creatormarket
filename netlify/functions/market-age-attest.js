const { json, getAdmin, originAllowed } = require("./_market-auth");
const { getMarketUser } = require("./_market-data");

exports.handler = async event => {
  if (event.httpMethod !== "POST") return json(405, { error: "Method not allowed" }, { Allow: "POST" });
  if (!originAllowed(event)) return json(403, { error: "Origin not allowed." });
  try {
    const auth = getMarketUser(event);
    if (auth.error) return auth.error;
    const admin = getAdmin(), db = admin.firestore();
    const ref = db.collection("users").doc(auth.uid), snap = await ref.get();
    if (!snap.exists) return json(403, { error: "Your DateVault account could not be verified." });
    const profile = snap.data() || {};
    if (profile.marketAgeVerified === true && profile.verificationStatus !== "reverification_requested") {
      return json(200, { ok: true, ageVerified: true, source: profile.marketAgeVerificationSource || "datevault", reused: true });
    }
    // DateVault membership status is not proof of age or identity approval.
    // This endpoint must not turn active_member (or any subscription state)
    // into marketplace age verification.
    return json(403, { error: "Complete Creator Market's age-assurance process before accessing restricted 18+ content." });

  } catch (error) {
    console.error("Market DateVault age attestation failed:", { message: error.message, code: error.code });
    return json(500, { error: "Unable to confirm your DateVault verification. Please retry shortly." });
  }
};
