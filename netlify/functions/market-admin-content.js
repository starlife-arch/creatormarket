const { json, parseBody } = require("./_market-auth");
const { getMarketUser, cleanText, isAdmin } = require("./_market-data");
const { adminFailure } = require("./_market-admin-error");

function iso(value) { return value?.toDate ? value.toDate().toISOString() : null; }
exports.handler = async event => {
  if (!["GET", "POST"].includes(event.httpMethod)) return json(405, { error: "Method not allowed" }, { Allow: "GET, POST" });
  try {
    const auth = getMarketUser(event);
    if (auth.error) return auth.error;
    const admin = require("./_market-auth").getAdmin(), db = admin.firestore();
    const adminSnap = await db.collection("users").doc(auth.uid).get();
    if (!adminSnap.exists || !isAdmin(adminSnap.data())) return json(403, { error: "Administrator access required." });
    if (event.httpMethod === "GET") {
      const [listingsSnap, creatorsSnap] = await Promise.all([
        db.collection("marketListings").limit(500).get(),
        db.collection("marketCreators").limit(400).get()
      ]);
      const creators = new Map(creatorsSnap.docs.map(doc => [doc.id, doc.data()]));
      const listings = listingsSnap.docs.map(doc => {
        const d = doc.data(), creator = creators.get(d.creatorUid) || {};
        return { id: doc.id, title: d.title || "Untitled content", description: d.description || "",
          status: d.status || "unknown", reviewStatus: d.reviewStatus || "not_reviewed",
          mediaKind: d.mediaKind || (d.mediaResourceType === "video" ? "video" : "image"),
          mediaProvider: d.mediaProvider || "", hasPrivateVideo: d.mediaProvider === "api_video" && Boolean(d.videoId),
          hasPrivateImage: Boolean(d.mediaPublicId && d.mediaResourceType !== "video"),
          creatorUid: d.creatorUid || "", creatorName: creator.displayName || creator.username || "Creator",
          creatorUsername: creator.username || d.creatorUsername || "", creatorStatus: creator.status || "unknown",
          offers: (Array.isArray(d.offers) ? d.offers : []).map(o => ({ label: String(o?.label || o?.type || "Access"), priceTokens: Number(o?.priceTokens || 0) })),
          createdAt: iso(d.createdAt), updatedAt: iso(d.updatedAt), moderationNote: d.moderationNote || "" };
      }).sort((a,b)=>(b.updatedAt||b.createdAt||"").localeCompare(a.updatedAt||a.createdAt||""));
      return json(200, { listings });
    }
    const body = parseBody(event), listingId = cleanText(body.listingId, 128);
    const action = cleanText(body.action, 30), note = cleanText(body.note, 500);
    if (!listingId || !["approve", "reject", "hide", "restore"].includes(action) || note.length < 8) {
      return json(400, { error: "Choose a content action and enter a review note of at least 8 characters." });
    }
    const ref = db.collection("marketListings").doc(listingId);
    const snap = await ref.get();
    if (!snap.exists || snap.data().status === "deleted") return json(404, { error: "Content not found." });
    const d = snap.data();
    if (action === "approve") {
      const hasPrivateMedia = (d.mediaProvider === "api_video" && Boolean(d.videoId))
        || (Boolean(d.mediaPublicId) && d.mediaResourceType !== "video");
      if (!hasPrivateMedia) return json(409, { error: "Upload private media before approving this listing." });
      const creator = await db.collection("marketCreators").doc(d.creatorUid).get();
      if (!creator.exists || creator.data().status !== "approved") return json(409, { error: "The creator must be approved before this listing can be published." });
    }
    const status = action === "approve" || action === "restore" ? "published" : "hidden";
    await ref.update({ status, reviewStatus: action === "approve" ? "approved" : action === "reject" ? "rejected" : action === "hide" ? "hidden" : "approved",
      moderationLocked: action === "reject" || action === "hide" ? true : false,
      moderationNote: note, reviewedBy: auth.uid, reviewedAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp() });
    await db.collection("marketAdminAudit").add({
      actorUid: auth.uid, action: "content_" + action, targetType: "listing",
      targetId: listingId, targetUid: d.creatorUid || "", reason: note,
      createdAt: admin.firestore.FieldValue.serverTimestamp()
    });
    return json(200, { ok: true, status, reviewStatus: action === "approve" || action === "restore" ? "approved" : action === "reject" ? "rejected" : "hidden" });
  } catch (error) {
    return adminFailure(error, "Unable to load or review creator content.");
  }
};
