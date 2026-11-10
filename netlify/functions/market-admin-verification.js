const { json, parseBody, getAdmin } = require("./_market-auth");
const { getMarketUser, cleanText, isAdmin } = require("./_market-data");

exports.handler = async event => {
  if (!["GET", "POST"].includes(event.httpMethod)) return json(405, { error: "Method not allowed." }, { Allow: "GET, POST" });
  try {
    const auth = getMarketUser(event);
    if (auth.error) return auth.error;
    const admin = getAdmin(), db = admin.firestore();
    const adminSnap = await db.collection("users").doc(auth.uid).get();
    if (!adminSnap.exists || !isAdmin(adminSnap.data())) return json(403, { error: "Administrator access required." });
    if (event.httpMethod === "GET") {
      const uid = cleanText(event.queryStringParameters?.uid || "", 128);
      if (!uid) return json(400, { error: "User UID is required." });
      const user = await db.collection("users").doc(uid).get();
      if (!user.exists) return json(404, { error: "User not found." });
      const d = user.data();
      return json(200, { uid, marketAgeVerified: d.marketAgeVerified === true, marketCreatorIdentityVerified: d.marketCreatorIdentityVerified === true });
    }
    const body = parseBody(event);
    const uid = cleanText(body.uid, 128), reason = cleanText(body.reason, 500);
    if (!uid || reason.length < 12 || body.confirmation !== "I_HAVE_REVIEWED_EVIDENCE" ||
        typeof body.marketCreatorIdentityVerified !== "boolean") {
      return json(400, { error: "Confirm identity evidence review, provide a reason, and select the creator identity verification state." });
    }
    const userRef = db.collection("users").doc(uid);
    await db.runTransaction(async tx => {
      const user = await tx.get(userRef);
      if (!user.exists) throw new Error("USER_NOT_FOUND");
      tx.update(userRef, {
        marketCreatorIdentityVerified: body.marketCreatorIdentityVerified,
        marketCreatorIdentityVerifiedAt: body.marketCreatorIdentityVerified ? admin.firestore.FieldValue.serverTimestamp() : null,
        marketCreatorIdentityVerifiedBy: auth.uid,
        marketCreatorIdentityVerificationNote: reason
      });
      tx.create(db.collection("marketAdminAudit").doc(), {
        actorUid: auth.uid, action: "market_creator_identity_verification_updated", targetUid: uid,
        marketCreatorIdentityVerified: body.marketCreatorIdentityVerified,
        reason, createdAt: admin.firestore.FieldValue.serverTimestamp()
      });
    });
    return json(200, { ok: true, marketCreatorIdentityVerified: body.marketCreatorIdentityVerified,
      message: "Creator identity status updated. Age verification is reviewed separately in the age-verification queue." });
  } catch (error) {
    if (error.message === "USER_NOT_FOUND") return json(404, { error: "User not found." });
    console.error("Market creator identity review failed:", error.message);
    return json(500, { error: "Unable to update creator identity verification." });
  }
};
