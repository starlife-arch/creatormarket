const { json } = require("./_market-auth");
const { loadMarketUser } = require("./_market-data");

exports.handler = async event => {
  if (event.httpMethod !== "GET") return json(405, { error: "Method not allowed" }, { Allow: "GET" });
  try {
    // Purchase history is an account feature; opening the media still
    // performs its own 18+ and entitlement checks.
    const context = await loadMarketUser(event);
    if (context.error) return context.error;
    const snap = await context.admin.firestore().collection("marketEntitlements")
      .where("buyerUid", "==", context.uid).orderBy("createdAt", "desc").limit(100).get();
    return json(200, { entitlements: snap.docs.map(doc => {
      const d = doc.data();
      const expires = d.expiresAt?.toDate ? d.expiresAt.toDate() : null;
      return { id: doc.id, listingId: d.listingId, creatorUid: d.creatorUid, creatorUsername: d.creatorUsername || "", listingTitle: d.listingTitle || "Creator content", offerType: d.offerType, status: d.status, expiresAt: expires?.toISOString() || null, active: d.status === "active" && (!expires || expires.getTime() > Date.now()) };
    })});
  } catch (error) {
    console.error("Market entitlement history failed:", error.message);
    return json(500, { error: "Unable to load your Market purchases." });
  }
};
