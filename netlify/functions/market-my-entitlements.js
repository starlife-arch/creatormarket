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
    const entitlements = snap.docs.map(doc => {
      const d = doc.data(), expires = dateValue(d.expiresAt), created = dateValue(d.createdAt);
      return { id: doc.id, listingId: d.listingId, creatorUid: d.creatorUid,
        creatorUsername: d.creatorUsername || "", listingTitle: d.listingTitle || "Creator content",
        offerType: d.offerType, status: d.status, expiresAt: expires?.toISOString() || null,
        active: d.status === "active" && (!expires || expires.getTime() > Date.now()),
        _createdAt: created?.getTime() || 0 };
    }).sort((a,b) => b._createdAt-a._createdAt).slice(0,100)
      .map(({_createdAt,...item})=>item);
    return json(200, { entitlements });
  } catch (error) {
    console.error("Market entitlement history failed:", { message:error.message, code:error.code, stack:error.stack });
    return json(500, { error: "Unable to load your Market purchases. Please retry shortly." });
  }
};
