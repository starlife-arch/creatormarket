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
      const snap = await db.collection("marketCreatorIdentityRequests")
        .where("status", "==", "pending_review").orderBy("submittedAt", "asc").limit(50).get();
      const now = Math.floor(Date.now() / 1000);
      const requests = snap.docs.map(doc => {
        const d = doc.data(), evidence = d.evidence || {};
        const url = item => item?.publicId ? cloudinary.utils.private_download_url(item.publicId, item.format, {
          resource_type: "image", type: "authenticated", expires_at: now + 60
        }) : null;
        return {
          uid: doc.id,
          username: d.username || null,
          submittedAt: d.submittedAt?.toDate ? d.submittedAt.toDate().toISOString() : null,
          identityDocumentUrl: url(evidence.identity_document),
          selfieUrl: url(evidence.selfie)
        };
      });
      return json(200, { requests });
    }

    const body = parseBody(event);
    const uid = cleanText(body.uid, 128), decision = cleanText(body.decision, 20), reason = cleanText(body.reason, 500);
    if (!uid || !["approve", "reject"].includes(decision) || reason.length < 12 ||
        body.confirmation !== "I_HAVE_REVIEWED_CREATOR_IDENTITY_EVIDENCE") {
      return json(400, { error: "Choose approve or reject, confirm evidence review, and provide a reason of at least 12 characters." });
    }
    const requestRef = db.collection("marketCreatorIdentityRequests").doc(uid);
    const requestSnap = await requestRef.get();
    if (!requestSnap.exists || requestSnap.data().status !== "pending_review") {
      return json(409, { error: "This creator identity request is no longer awaiting review." });
    }
    const evidence = requestSnap.data().evidence || {};
    if (!evidence.identity_document || !evidence.selfie) {
      return json(409, { error: "Both private identity evidence files are required." });
    }
    const approved = decision === "approve";
    await db.runTransaction(async tx => {
      const fresh = await tx.get(requestRef);
      const userRef = db.collection("users").doc(uid);
      const userSnap = await tx.get(userRef);
      if (!fresh.exists || fresh.data().status !== "pending_review") throw new Error("IDENTITY_REVIEW_NOT_PENDING");
      if (!userSnap.exists) throw new Error("IDENTITY_USER_NOT_FOUND");
      tx.update(userRef, {
        marketCreatorIdentityVerified: approved,
        marketCreatorIdentityVerifiedAt: approved ? admin.firestore.FieldValue.serverTimestamp() : null,
        marketCreatorIdentityVerifiedBy: auth.uid,
        marketCreatorIdentityReviewNote: reason
      });
      tx.update(requestRef, {
        status: approved ? "approved" : "rejected",
        reviewNote: reason, reviewedBy: auth.uid,
        reviewedAt: admin.firestore.FieldValue.serverTimestamp(),
        evidence: {}, evidenceDeletedAt: admin.firestore.FieldValue.serverTimestamp()
      });
      tx.create(db.collection("marketAdminAudit").doc(), {
        actorUid: auth.uid,
        action: approved ? "market_creator_identity_approved" : "market_creator_identity_rejected",
        targetUid: uid, reason,
        createdAt: admin.firestore.FieldValue.serverTimestamp()
      });
    });
    for (const item of Object.values(evidence)) {
      if (item?.publicId) await cloudinary.uploader.destroy(item.publicId, {
        resource_type: "image", type: "authenticated", invalidate: true
      }).catch(error => console.error("Creator identity evidence deletion failed:", error.message));
    }
    return json(200, { ok: true, status: approved ? "approved" : "rejected" });
  } catch (error) {
    if (error.message === "IDENTITY_REVIEW_NOT_PENDING") return json(409, { error: "This request has already been reviewed." });
    if (error.message === "IDENTITY_USER_NOT_FOUND") return json(404, { error: "Creator account not found." });
    if (error.code === "CLOUDINARY_CONFIG") return json(503, { error: "Secure evidence storage is not configured yet." });
    console.error("Market creator identity review failed:", error.message);
    return json(500, { error: "Unable to review creator identity evidence." });
  }
};
