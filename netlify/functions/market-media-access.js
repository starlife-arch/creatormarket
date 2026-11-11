const { cloudinary } = require("./_cloudinary");
const { json } = require("./_market-auth");
const { loadEligibleUser, cleanText } = require("./_market-data");
exports.handler = async event => {
  if (event.httpMethod !== "GET") return json(405, { error: "Method not allowed" }, { Allow: "GET" });
  try {
    const context = await loadEligibleUser(event);
    if (context.error) return context.error;
    const listingId = cleanText(event.queryStringParameters?.listingId || "", 128);
    if (!listingId) return json(400, { error: "Listing ID is required." });
    const db = context.admin.firestore(), listing = await db.collection("marketListings").doc(listingId).get();
    if (!listing.exists) return json(404, { error: "This content is unavailable." });
    const data = listing.data(), creatorProfile = await db.collection("marketCreators").doc(data.creatorUid).get();
    if (data.mediaResourceType === "video" && data.mediaProvider !== "api_video") return json(410, { error: "This older video must be re-uploaded through secure api.video playback before it can be watched." });
    const isOwner = data.creatorUid === context.uid;
    let entitlement = null;
    if (!isOwner) {
      const snap = await db.collection("marketEntitlements").where("buyerUid", "==", context.uid).where("listingId", "==", listingId).where("status", "==", "active").limit(10).get();
      const now = Date.now();
      entitlement = snap.docs.map(d => d.data()).find(d => {
        const exp = d.expiresAt?.toDate ? d.expiresAt.toDate().getTime() : null;
        return !exp || exp > now;
      });
      if (!entitlement) return json(403, { error: "Purchase an access offer to view this content." });
    } else if (!creatorProfile.exists || creatorProfile.data().status !== "approved") return json(404, { error: "This content is unavailable." });
    // Pausing, hiding or soft-deleting a listing does not revoke an already-paid entitlement.
    if (!data.mediaPublicId) return json(404, { error: "This purchased image is no longer available. Contact Market support." });
    const downloadAllowed = isOwner ? false : data.downloadAllowed === true && entitlement?.downloadAllowed === true;
    const expiresAt = Math.floor(Date.now() / 1000) + 60;
    cloudinary.config({ secure: true });
    const mediaUrl = cloudinary.utils.private_download_url(data.mediaPublicId, data.mediaFormat, {
      resource_type: data.mediaResourceType, type: "authenticated", expires_at: expiresAt, attachment: downloadAllowed
    });
    return json(200, { ok: true, mediaUrl, contentType: data.mediaContentType || "application/octet-stream", downloadAllowed, expiresInSeconds: 60 });
  } catch (error) {
    if (error.code === "CLOUDINARY_CONFIG") return json(503, { error: "Secure Cloudinary media storage is not configured." });
    console.error("Market Cloudinary media access failed:", error.message);
    return json(500, { error: "Unable to authorize this media request." });
  }
};
