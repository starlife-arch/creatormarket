const { cloudinary } = require("./_cloudinary");
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
    cloudinary.config({ secure: true });
    if (event.httpMethod === "GET") {
      const snap = await db.collection("marketAgeVerificationRequests").where("status", "==", "pending_review").orderBy("submittedAt", "asc").limit(50).get();
      const now = Math.floor(Date.now() / 1000);
      const requests = snap.docs.map(doc => {
        const d = doc.data(), e = d.evidence || {};
        const url = item => item?.publicId ? cloudinary.utils.private_download_url(item.publicId, item.format, {
          resource_type: "image", type: "authenticated", expires_at: now + 60
        }) : null;
        return { uid: doc.id, submittedAt: d.submittedAt?.toDate ? d.submittedAt.toDate().toISOString() : null,
          identityDocumentUrl: url(e.identity_document), selfieUrl: url(e.selfie) };
      });
      return json(200, { requests });
    }
    const body = parseBody(event);
    const uid = cleanText(body.uid, 128), decision = cleanText(body.decision, 20), reason = cleanText(body.reason, 500);
    if (!uid || !["approve", "reject"].includes(decision) || reason.length < 12) return json(400, { error: "Choose approve or reject and provide a review reason of at least 12 characters." });
    const requestRef = db.collection("marketAgeVerificationRequests").doc(uid);
    const snap = await requestRef.get();
    if (!snap.exists || snap.data().status !== "pending_review") return json(409, { error: "This request is no longer awaiting review." });
    const evidence = snap.data().evidence || {};
    if (!evidence.identity_document || !evidence.selfie) return json(409, { error: "Both evidence files are required before review." });
    const approved = decision === "approve";
    await db.runTransaction(async tx => {
      const fresh = await tx.get(requestRef);
      if (!fresh.exists || fresh.data().status !== "pending_review") throw new Error("REQUEST_NOT_PENDING");
      tx.update(db.collection("users").doc(uid), {
        marketAgeVerified: approved,
        marketAgeVerifiedAt: approved ? admin.firestore.FieldValue.serverTimestamp() : null,
        marketAgeVerifiedBy: auth.uid,
        marketAgeVerificationMethod: "manual_document_and_selfie_review",
        marketAgeVerificationProvider: null
      });
      tx.update(requestRef, { status: approved ? "approved" : "rejected", reviewNote: reason,
        reviewedAt: admin.firestore.FieldValue.serverTimestamp(), reviewedBy: auth.uid,
        evidence: {}, evidenceDeletedAt: admin.firestore.FieldValue.serverTimestamp() });
      tx.create(db.collection("marketAdminAudit").doc(), {
        actorUid: auth.uid, action: approved ? "market_age_manual_review_approved" : "market_age_manual_review_rejected",
        targetUid: uid, reason, createdAt: admin.firestore.FieldValue.serverTimestamp()
      });
    });
    for (const item of Object.values(evidence)) {
      if (item?.publicId) await cloudinary.uploader.destroy(item.publicId, {
        resource_type: "image", type: "authenticated", invalidate: true
      }).catch(err => console.error("Age evidence deletion failed:", err.message));
    }
    return json(200, { ok: true, status: approved ? "approved" : "rejected" });
  } catch (error) {
    if (error.code === "CLOUDINARY_CONFIG") return json(503, { error: "Secure evidence storage is not configured yet." });
    if (error.message === "REQUEST_NOT_PENDING") return json(409, { error: "This request is no longer awaiting review." });
    console.error("Market age review failed:", error.message);
    return json(500, { error: "Unable to review this age-verification request." });
  }
};
