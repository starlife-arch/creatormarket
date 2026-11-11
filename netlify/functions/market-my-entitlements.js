const { json } = require("./_market-auth");
const { loadMarketUser } = require("./_market-data");

function dateValue(value) {
  if (value?.toDate) return value.toDate();
  if (value instanceof Date) return value;
  return null;
}

exports.handler = async event => {
  if (event.httpMethod !== "GET") return json(405, { error: "Method not allowed" }, { Allow: "GET" });
  try {
    const context = await loadMarketUser(event);
    if (context.error) return context.error;
    // Filter on one indexed field only. Sort in memory to avoid depending on a
    // composite index being deployed before the Market release.
    const snap = await context.admin.firestore().collection("marketEntitlements")
      .where("buyerUid", "==", context.uid).limit(250).get();
    const entitlements = (await Promise.all(snap.docs.map(async doc => {
      const d = doc.data(), expires = dateValue(d.expiresAt), created = dateValue(d.createdAt);
      const started = dateValue(d.startedAt) || created;
      const listingSnap = d.listingId ? await context.admin.firestore().collection("marketListings").doc(d.listingId).get() : null;
      const listing = listingSnap?.exists ? listingSnap.data() : {};
      return { id: doc.id, listingId: d.listingId, creatorUid: d.creatorUid,
        creatorUsername: d.creatorUsername || "", listingTitle: d.listingTitle || listing.title || "Creator content",
        offerType: d.offerType || "rental", offerLabel: d.offerLabel || "",
        offerUnit: d.offerUnit || null, offerValue: Number.isFinite(Number(d.offerValue)) ? Number(d.offerValue) : null,
        priceTokens: Number(d.priceTokens || 0), status: d.status,
        mediaProvider: listing.mediaProvider || "", mediaKind: listing.mediaKind || (listing.mediaResourceType === "video" ? "video" : "image"),
        startedAt: started?.toISOString() || null, expiresAt: expires?.toISOString() || null,
        active: d.status === "active" && (!expires || expires.getTime() > Date.now()),
        _createdAt: created?.getTime() || started?.getTime() || 0 };
    }))).sort((a,b) => b._createdAt-a._createdAt).slice(0,100)
      .map(({_createdAt,...item})=>item);
    return json(200, { entitlements });
  } catch (error) {
    console.error("Market entitlement history failed:", { message:error.message, code:error.code, stack:error.stack });
    return json(500, { error: "Unable to load your Market purchases. Please retry shortly." });
  }
};
