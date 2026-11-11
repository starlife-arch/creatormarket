const crypto = require("crypto");
const { json, parseBody } = require("./_market-auth");
const { loadEligibleUser, cleanText } = require("./_market-data");
const { adminFailure } = require("./_market-admin-error");

function normalizeOffers(input) {
  if (!Array.isArray(input) || input.length < 1 || input.length > 3) throw new Error("Add between one and three access offers.");
  return input.map(raw => {
    const type = raw?.type, priceTokens = Math.floor(Number(raw?.priceTokens));
    if (!Number.isSafeInteger(priceTokens) || priceTokens < 1 || priceTokens > 10000000) throw new Error("Each offer needs a valid token price.");
    if (!["timed", "rental", "permanent"].includes(type)) throw new Error("Unsupported offer type.");
    const offer = { id: crypto.randomUUID(), type, label: cleanText(raw.label, 50) || (type === "timed" ? "Timed viewing" : type === "rental" ? "Rental" : "Permanent access"), priceTokens };
    if (type === "timed" || type === "rental") {
      const unit = raw.unit, value = Math.floor(Number(raw.value));
      const allowed = type === "timed" ? ["minute", "hour"] : ["day", "week", "month"];
      if (!allowed.includes(unit) || !Number.isSafeInteger(value) || value < 1 || value > 365) throw new Error("Offer duration is invalid.");
      offer.unit = unit; offer.value = value;
    }
    return offer;
  });
}
exports.handler = async event => {
  if (!["GET", "POST"].includes(event.httpMethod)) return json(405, { error: "Method not allowed" }, { Allow: "GET, POST" });
  try {
    const context = await loadEligibleUser(event);
    if (context.error) return context.error;
    const db = context.admin.firestore();
    if (event.httpMethod === "GET") {
      const mine = event.queryStringParameters?.mine === "1";
      if (mine) {
        const creator = await db.collection("marketCreators").doc(context.uid).get();
        if (!creator.exists || creator.data().status !== "approved") return json(403, { error: "An approved creator account is required." });
        // Avoid composite-index dependency; sort the bounded result in memory.
        const snap = await db.collection("marketListings").where("creatorUid", "==", context.uid).limit(100).get();
        const listings = [...snap.docs].filter(doc => !(doc.data().mediaResourceType === "video" && doc.data().mediaProvider !== "api_video")).sort((a,b) => (b.data().updatedAt?.toMillis?.() || 0) - (a.data().updatedAt?.toMillis?.() || 0)).slice(0,50);
        return json(200, { listings: listings.map(d => ({ id: d.id, ...d.data() })) });
      }
      const username = cleanText(event.queryStringParameters?.u || "", 30).toLowerCase().replace(/^@/, "");
      if (!username) return json(400, { error: "Creator username is required." });
      const handle = await db.collection("marketCreatorHandles").doc(username).get();
      if (!handle.exists) return json(404, { error: "Creator not found." });
      const blocked = await db.collection("marketBlocks").doc(context.uid).collection("blocked").doc(handle.data().uid).get();
      if (blocked.exists) return json(404, { error: "Creator not found." });
      const creatorProfile = await db.collection("marketCreators").doc(handle.data().uid).get();
      if (!creatorProfile.exists || creatorProfile.data().status !== "approved") return json(404, { error: "Creator not found." });
      const snap = await db.collection("marketListings").where("creatorUid", "==", handle.data().uid).where("status", "==", "published").limit(100).get();
      const listings = [...snap.docs].sort((a,b) => (b.data().updatedAt?.toMillis?.() || 0) - (a.data().updatedAt?.toMillis?.() || 0)).slice(0,50);
      return json(200, { listings: listings.map(d => {
        const v = d.data();
        return { id: d.id, title: v.title, description: v.description, offers: v.offers, hasVideo: v.mediaProvider === "api_video" && Boolean(v.videoId), mediaKind: v.mediaKind || (v.mediaResourceType === "video" ? "video" : "image"), durationSeconds: Number(v.durationSeconds || 0), createdAt: v.createdAt?.toDate ? v.createdAt.toDate().toISOString() : null };
      }) });
    }
    const creator = await db.collection("marketCreators").doc(context.uid).get();
    if (!creator.exists || creator.data().status !== "approved" || context.profile.marketCreatorIdentityVerified !== true) return json(403, { error: "An approved creator with verified identity is required to manage listings." });
    const body = parseBody(event), title = cleanText(body.title, 90), description = cleanText(body.description, 1200);
    if (title.length < 3 || description.length < 20) return json(400, { error: "Enter a title (at least 3 characters) and description (at least 20 characters)." });
    const offers = normalizeOffers(body.offers), ref = db.collection("marketListings").doc();
    await ref.set({
      creatorUid: context.uid, creatorUsername: creator.data().username, title, description, offers,
      downloadAllowed: body.downloadAllowed === true, mediaPublicId: null, status: "draft",
      createdAt: context.admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: context.admin.firestore.FieldValue.serverTimestamp()
    });
    return json(201, { ok: true, listingId: ref.id, status: "draft", message: "Listing saved as a draft. Upload private media to publish it." });
  } catch (error) {
    if (error.message && /offer|duration|token price/i.test(error.message)) return json(400, { error: error.message });
    return adminFailure(error, "Unable to save or load creator listings.");
  }
};
