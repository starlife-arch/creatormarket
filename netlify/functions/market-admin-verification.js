const { json, parseBody, getAdmin } = require("./_market-auth");
const { getMarketUser, cleanText, isAdmin } = require("./_market-data");

exports.handler = async event => {
  if (event.httpMethod !== "POST") return json(405, { error: "Method not allowed" }, { Allow: "POST" });
  try {
    const auth = getMarketUser(event);
    if (auth.error) return auth.error;
    const admin = getAdmin(), db = admin.firestore();
    const adminSnap = await db.collection("users").doc(auth.uid).get();
    if (!adminSnap.exists || !isAdmin(adminSnap.data())) return json(403, { error: "Administrator access required." });

    const body = parseBody(event);
    const uid = cleanText(body.uid, 128), reason = cleanText(body.reason, 500);
    if (!uid || reason.length < 12 || body.confirmation !== "I_HAVE_REVIEWED_EVIDENCE" ||
        typeof body.marketCreatorIdentityVerified !== "boolean") {
      return json(400, { error: "Select the creator identity decision, confirm evidence review, and provide a reason of at least 12 characters." });
    }
    const userRef = db.collection("users").doc(uid);
    const applicationRef = db.collection("marketCreatorApplications").doc(uid);
    await db.runTransaction(async tx => {
      const [user, application] = await Promise.all([tx.get(userRef), tx.get(applicationRef)]);
      if (!user.exists) throw new Error("USER_NOT_FOUND");
      if (!application.exists) throw new Error("APPLICATION_NOT_FOUND");
      tx.update(userRef, {
        marketCreatorIdentityVerified: body.marketCreatorIdentityVerified,
        marketCreatorIdentityVerifiedAt: body.marketCreatorIdentityVerified ? admin.firestore.FieldValue.serverTimestamp() : null,
        marketCreatorIdentityVerifiedBy: auth.uid,
        marketCreatorIdentityReviewNote: reason
      });
      tx.create(db.collection("marketAdminAudit").doc(), {
        actorUid: auth.uid,
        action: body.marketCreatorIdentityVerified ? "market_creator_identity_verified" : "market_creator_identity_rejected",
        targetUid: uid, reason,
        createdAt: admin.firestore.FieldValue.serverTimestamp()
      });
    });
    return json(200, { ok: true, marketCreatorIdentityVerified: body.marketCreatorIdentityVerified });
  } catch (error) {
    if (error.message === "USER_NOT_FOUND") return json(404, { error: "User not found." });
    if (error.message === "APPLICATION_NOT_FOUND") return json(404, { error: "Creator application not found." });
    console.error("Market creator identity review failed:", error.message);
    return json(500, { error: "Unable to update creator identity verification." });
  }
};
