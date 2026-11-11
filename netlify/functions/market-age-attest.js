const { json, getAdmin, originAllowed } = require("./_market-auth");
const { getMarketUser } = require("./_market-data");

function approvalDate(value) {
  if (value?.toDate) return value.toDate();
  if (value instanceof Date) return value;
  if (typeof value === "string" || typeof value === "number") {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
  }
  return null;
}

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
    // DateVault only sets active_member after its own ID/selfie review. A
    // self-attestation alone is never sufficient for access to adult content.
    if (profile.status !== "active_member" || profile.verificationStatus === "reverification_requested") {
      return json(403, { error: "Complete or refresh DateVault identity verification before confirming 18+ access." });
    }
    const approvedAt = approvalDate(profile.approvedAt);
    if (!approvedAt || Date.now() - approvedAt.getTime() > 90 * 86400000 || approvedAt.getTime() > Date.now() + 300000) {
      return json(403, { error: "Your DateVault verification needs to be refreshed before Market access can be enabled." });
    }
    await ref.update({
      marketAgeVerified: true,
      marketAgeVerificationStatus: "approved",
      marketAgeVerificationMethod: "datevault_kyc_plus_attestation",
      marketAgeAttested: true,
      marketAgeAttestedAt: admin.firestore.FieldValue.serverTimestamp(),
      marketAgeVerifiedAt: admin.firestore.FieldValue.serverTimestamp()
    });
    return json(200, { ok: true, ageVerified: true, source: "datevault_kyc_plus_attestation" });
  } catch (error) {
    console.error("Market DateVault age attestation failed:", { message: error.message, code: error.code });
    return json(500, { error: "Unable to confirm your DateVault verification. Please retry shortly." });
  }
};
