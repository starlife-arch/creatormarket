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
        const listings = [...snap.docs].sort((a,b) => (b.data().updatedAt?.toMillis?.() || 0) - (a.data().updatedAt?.toMillis?.() || 0)).slice(0,50);
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
      const creatorData = creatorProfile.data();
      const snap = await db.collection("marketListings").where("creatorUid", "==", handle.data().uid).where("status", "==", "published").limit(100).get();
      const listings = [...snap.docs].filter(doc => !(doc.data().mediaResourceType === "video" && doc.data().mediaProvider !== "api_video")).sort((a,b) => (b.data().updatedAt?.toMillis?.() || 0) - (a.data().updatedAt?.toMillis?.() || 0)).slice(0,50);
      return json(200, { listings: listings.map(d => {
        const v = d.data();
        return { id: d.id, title: v.title, description: v.description, offers: v.offers, hasVideo: v.mediaProvider === "api_video" && Boolean(v.videoId), mediaKind: v.mediaKind || (v.mediaResourceType === "video" ? "video" : "image"), durationSeconds: Number(v.durationSeconds || 0), creatorUsername: creatorData.username || username, creatorName: creatorData.displayName || creatorData.username || username, creatorAvatarUrl: creatorData.avatarPreviewUrl || creatorData.avatarUrl || "", createdAt: v.createdAt?.toDate ? v.createdAt.toDate().toISOString() : null };
      }) });
    }
    const creator = await db.collection("marketCreators").doc(context.uid).get();
    if (!creator.exists || creator.data().status !== "approved" || context.profile.marketCreatorIdentityVerified !== true) return json(403, { error: "An approved creator with verified identity is required to manage listings." });
    const body = parseBody(event);
    if (body.action) {
      const listingId = cleanText(body.listingId, 128);
      if (!listingId) return json(400, { error: "Listing ID is required." });
      const listingRef = db.collection("marketListings").doc(listingId), existing = await listingRef.get();
      if (!existing.exists || existing.data().creatorUid !== context.uid) return json(404, { error: "Your listing was not found." });
      if (body.action === "delete") {
        await listingRef.update({ status: "deleted", updatedAt: context.admin.firestore.FieldValue.serverTimestamp() });
        return json(200, { ok: true, status: "deleted" });
      }
      if (body.action === "update") {
        const title = cleanText(body.title, 90), description = cleanText(body.description, 1200);
        if (title.length < 3 || description.length < 20) return json(400, { error: "Enter a title (at least 3 characters) and description (at least 20 characters)." });
        const offers = normalizeOffers(body.offers);
        await listingRef.update({ title, description, offers, updatedAt: context.admin.firestore.FieldValue.serverTimestamp() });
        return json(200, { ok: true, status: existing.data().status });
      }
      if (body.action === "status") {
        const status = cleanText(body.status, 20);
        if (!["published", "paused"].includes(status)) return json(400, { error: "Choose published or paused status." });
        const data = existing.data();
        if (status === "published" && data.moderationLocked === true) return json(403, { error: "This listing is locked by Market moderation. Contact support or wait for an administrator review." });
        if (status === "published" && !((data.mediaProvider === "api_video" && data.videoId) || (data.mediaPublicId && data.mediaResourceType !== "video"))) return json(409, { error: "Upload valid private media before publishing this listing." });
        await listingRef.update({ status, updatedAt: context.admin.firestore.FieldValue.serverTimestamp() });
        return json(200, { ok: true, status });
      }
      return json(400, { error: "Unsupported listing management action." });
    }
    const platformSettings = await db.collection("marketSettings").doc("platform").get();
    if (platformSettings.exists && platformSettings.data().newListingsEnabled === false) {
      return json(403, { error: "New creator listings are temporarily paused. Existing listings and purchases remain available." });
    }
    const title = cleanText(body.title, 90), description = cleanText(body.description, 1200);
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
