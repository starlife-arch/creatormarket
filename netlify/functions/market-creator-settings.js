const { json, parseBody } = require("./_market-auth");
const { loadEligibleUser, cleanText } = require("./_market-data");

exports.handler = async event => {
  if (!["GET", "POST"].includes(event.httpMethod)) return json(405, { error: "Method not allowed" }, { Allow: "GET, POST" });
  try {
    const context = await loadEligibleUser(event);
    if (context.error) return context.error;
    const db = context.admin.firestore();
    const ref = db.collection("marketCreators").doc(context.uid);
    const snap = await ref.get();
    if (!snap.exists || snap.data().status !== "approved" || context.profile.marketCreatorIdentityVerified !== true) {
      return json(403, { error: "An approved, identity-verified creator account is required." });
    }
    if (event.httpMethod === "GET") {
      const d = snap.data();
      return json(200, { profile: { displayName: d.displayName || "", bio: d.bio || "",
        category: d.category || "Adult Content", username: d.username || "" } });
    }
    const body = parseBody(event);
    const displayName = cleanText(body.displayName, 60);
    const bio = cleanText(body.bio, 500);
    const category = cleanText(body.category, 40);
    if (!displayName || bio.length < 20) return json(400, { error: "Enter a display name and a bio of at least 20 characters." });
    if (!["Adult Content", "Mature Content", "Explicit Content"].includes(category)) return json(400, { error: "Choose a valid creator category." });
    await ref.update({ displayName, bio, category, updatedAt: context.admin.firestore.FieldValue.serverTimestamp() });
    return json(200, { ok: true, profile: { displayName, bio, category, username: snap.data().username || "" } });
  } catch (error) {
    console.error("Creator settings update failed:", error?.message || error);
    return json(500, { error: "Unable to update creator settings." });
  }
};
