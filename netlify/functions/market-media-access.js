const { getStorage } = require("firebase-admin/storage");
const { json } = require("./_market-auth");
const { loadEligibleUser, cleanText } = require("./_market-data");

exports.handler = async event => {
  if (event.httpMethod !== "GET") return json(405, { error: "Method not allowed" }, { Allow: "GET" });
  try {
    const context = await loadEligibleUser(event);
    if (context.error) return context.error;
    const listingId = cleanText(event.queryStringParameters?.listingId || "", 128);
    if (!listingId) return json(400, { error: "Listing ID is required." });
    const db = context.admin.firestore();
    const listingRef = db.collection("marketListings").doc(listingId);
    const listing = await listingRef.get();
    if (!listing.exists || listing.data().status !== "published" || !listing.data().mediaObjectPath) return json(404, { error: "This content is unavailable." });
    const data = listing.data();
    const creatorProfile = await db.collection("marketCreators").doc(data.creatorUid).get();
    if (!creatorProfile.exists || creatorProfile.data().status !== "approved") return json(404, { error: "This content is unavailable." });
    const isOwner = data.creatorUid === context.uid;
    let entitlement = null;
    if (!isOwner) {
      const snap = await db.collection("marketEntitlements")
        .where("buyerUid", "==", context.uid).where("listingId", "==", listingId)
        .where("status", "==", "active").limit(10).get();
      const now = Date.now();
      entitlement = snap.docs.map(d => d.data()).find(d => {
        const exp = d.expiresAt?.toDate ? d.expiresAt.toDate().getTime() : null;
        return !exp || exp > now;
      });
      if (!entitlement) return json(403, { error: "Purchase an access offer to view this content." });
    }
    const bucketName = process.env.MARKET_STORAGE_BUCKET;
    if (!bucketName) return json(503, { error: "Private Market storage is not configured." });
    const downloadAllowed = isOwner ? false : data.downloadAllowed === true && entitlement?.downloadAllowed === true;
    const [url] = await getStorage(context.admin.app()).bucket(bucketName).file(data.mediaObjectPath).getSignedUrl({
      version: "v4", action: "read", expires: Date.now() + 60 * 1000,
      responseType: data.mediaContentType || "application/octet-stream",
      responseDisposition: downloadAllowed ? "attachment" : "inline",
      responseCacheControl: "private, no-store, max-age=0"
    });
    return json(200, { ok: true, mediaUrl: url, contentType: data.mediaContentType || "application/octet-stream", downloadAllowed, expiresInSeconds: 60 });
  } catch (error) {
    console.error("Market media access failed:", error.message);
    return json(500, { error: "Unable to authorize this media request." });
  }
};
