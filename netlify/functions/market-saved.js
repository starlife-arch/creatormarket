const crypto = require("crypto");
const { json, parseBody } = require("./_market-auth");
const { loadEligibleUser, cleanText } = require("./_market-data");

function savedId(type, targetId) {
  return crypto.createHash("sha256").update(type + ":" + targetId).digest("hex");
}
exports.handler = async event => {
  if (!["GET", "POST", "DELETE"].includes(event.httpMethod)) return json(405, { error: "Method not allowed" }, { Allow: "GET, POST, DELETE" });
  try {
    const context = await loadEligibleUser(event);
    if (context.error) return context.error;
    const db = context.admin.firestore();
    const saved = db.collection("users").doc(context.uid).collection("marketSaved");
    if (event.httpMethod === "GET") {
      const snap = await saved.limit(200).get();
      const items = await Promise.all(snap.docs.map(async doc => {
        const d = doc.data(), type = d.type, targetId = d.targetId;
        if (type === "creator") {
          const creatorSnap = await db.collection("marketCreators").doc(targetId).get();
          if (!creatorSnap.exists) return null;
          const c = creatorSnap.data();
          return { id: doc.id, type, targetId, title: c.displayName || c.username || "Creator",
            subtitle: "@" + (c.username || ""), avatarUrl: c.avatarPreviewUrl || c.avatarUrl || "",
            url: "/creator?u=" + encodeURIComponent(c.username || ""), createdAt: d.createdAt?.toDate ? d.createdAt.toDate().toISOString() : null };
        }
        if (type === "listing") {
          const listingSnap = await db.collection("marketListings").doc(targetId).get();
          if (!listingSnap.exists) return null;
          const l = listingSnap.data();
          const creatorSnap = l.creatorUid ? await db.collection("marketCreators").doc(l.creatorUid).get() : null;
          const creator = creatorSnap?.exists ? creatorSnap.data() : {};
          return { id: doc.id, type, targetId, title: l.title || "Creator content",
            subtitle: "@" + (creator.username || l.creatorUsername || "creator"),
            avatarUrl: creator.avatarPreviewUrl || creator.avatarUrl || "",
            url: "/creator?u=" + encodeURIComponent(creator.username || l.creatorUsername || ""),
            available: l.status === "published", createdAt: d.createdAt?.toDate ? d.createdAt.toDate().toISOString() : null };
        }
        return null;
      }));
      return json(200, { items: items.filter(Boolean) });
    }
    const body = event.httpMethod === "POST" ? parseBody(event) : event.queryStringParameters || {};
    const type = cleanText(body.type, 20), targetId = cleanText(body.targetId, 128);
    if (!["creator", "listing"].includes(type) || !targetId) return json(400, { error: "Choose a creator or listing to save." });
    const ref = saved.doc(savedId(type, targetId));
    if (event.httpMethod === "DELETE") {
      await ref.delete();
      return json(200, { ok: true, removed: true });
    }
    if (type === "creator") {
      const creator = await db.collection("marketCreators").doc(targetId).get();
      if (!creator.exists || creator.data().status !== "approved") return json(404, { error: "Creator not found." });
    } else {
      const listing = await db.collection("marketListings").doc(targetId).get();
      if (!listing.exists || listing.data().status !== "published") return json(404, { error: "This listing is not available to save." });
    }
    await ref.set({ type, targetId, createdAt: context.admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
    return json(200, { ok: true, saved: true });
  } catch (error) {
    console.error("Market saved items failed:", error?.message || error);
    return json(500, { error: "Unable to update your saved content." });
  }
};
