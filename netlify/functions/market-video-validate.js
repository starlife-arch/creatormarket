const crypto = require("crypto");
const { getAdmin, json, parseBody } = require("./_market-auth");

function validSignature(rawBody, supplied) {
  const secret = process.env.MARKET_VIDEO_GATEWAY_SECRET || "";
  if (secret.length < 32 || !supplied) return false;
  const expected = crypto.createHmac("sha256", secret).update(rawBody).digest();
  let actual;
  try { actual = Buffer.from(supplied, "base64url"); } catch (_) { return false; }
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
}
exports.handler = async event => {
  if (event.httpMethod !== "POST") return json(405, { error: "Method not allowed." }, { Allow: "POST" });
  const rawBody = event.isBase64Encoded ? Buffer.from(event.body || "", "base64").toString("utf8") : (event.body || "");
  const signature = event.headers?.["x-market-video-gateway-signature"] || event.headers?.["X-Market-Video-Gateway-Signature"] || "";
  if (!validSignature(rawBody, signature)) return json(403, { error: "Invalid gateway authorization." });
  try {
    const body = parseBody(event);
    const uid = String(body.uid || ""), listingId = String(body.listingId || ""), videoId = String(body.videoId || "");
    const scope = String(body.scope || ""), expMs = Number(body.expMs);
    if (!uid || !listingId || !videoId || !["preview", "playback", "download"].includes(scope) || !Number.isFinite(expMs) || expMs <= Date.now()) {
      return json(403, { error: "Playback authorization has expired." });
    }
    const admin = getAdmin(), db = admin.firestore();
    const [userSnap, listingSnap] = await Promise.all([
      db.collection("users").doc(uid).get(),
      db.collection("marketListings").doc(listingId).get()
    ]);
    if (!userSnap.exists || !listingSnap.exists) return json(403, { error: "Market access is unavailable." });
    const user = userSnap.data() || {}, listing = listingSnap.data() || {};
    if (user.marketAgeVerified !== true || user.banned || user.suspended || user.accountSuspended) return json(403, { error: "Age verification or account access is no longer valid." });
    if (listing.status !== "published" || listing.mediaProvider !== "api_video" || listing.videoId !== videoId) return json(403, { error: "This video is no longer available." });
    const creatorSnap = await db.collection("marketCreators").doc(listing.creatorUid).get();
    if (!creatorSnap.exists || creatorSnap.data().status !== "approved") return json(403, { error: "Creator access is no longer valid." });
    if (scope === "preview") return json(200, { ok: true });
    const isOwner = listing.creatorUid === uid;
    if (!isOwner) {
      let entitlements = await db.collection("users").doc(uid).collection("marketEntitlements").where("listingId", "==", listingId).get();
      if (!entitlements.docs.length) entitlements = await db.collection("marketEntitlements").where("buyerUid", "==", uid).get();
      const now = Date.now();
      const entitlement = entitlements.docs.map(doc => doc.data()).find(item => {
        if (item.listingId !== listingId || item.status !== "active") return false;
        const expiry = item.expiresAt?.toDate ? item.expiresAt.toDate().getTime() : item.expiresAt ? new Date(item.expiresAt).getTime() : null;
        return !expiry || expiry > now;
      });
      if (!entitlement) return json(403, { error: "Your purchase or rental is no longer active." });
      const entitlementExpiry = entitlement.expiresAt?.toDate ? entitlement.expiresAt.toDate().getTime() : entitlement.expiresAt ? new Date(entitlement.expiresAt).getTime() : null;
      if (entitlementExpiry && expMs > entitlementExpiry) return json(403, { error: "Playback ticket exceeds the rental expiry." });
      if (scope === "download" && (listing.downloadAllowed !== true || entitlement.downloadAllowed !== true)) return json(403, { error: "Downloads are not enabled for this purchase." });
    } else if (scope === "download") {
      return json(403, { error: "Creator preview sessions do not grant downloads." });
    }
    return json(200, { ok: true });
  } catch (error) {
    console.error("Market video entitlement validation failed:", error.message);
    return json(503, { error: "Playback authorization is temporarily unavailable." });
  }
};
