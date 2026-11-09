const { json } = require("./_market-auth");
const { loadEligibleUser, cleanText } = require("./_market-data");

exports.handler = async event => {
  if (event.httpMethod !== "GET") return json(405, { error: "Method not allowed" }, { Allow: "GET" });
  try {
    const context = await loadEligibleUser(event);
    if (context.error) return context.error;
    const username = cleanText(event.queryStringParameters?.u || "", 30).toLowerCase().replace(/^@/, "");
    if (!username) return json(400, { error: "Creator username is required." });
    const db = context.admin.firestore();
    const handle = await db.collection("marketCreatorHandles").doc(username).get();
    if (!handle.exists) return json(404, { error: "Creator not found." });
    const blocked = await db.collection("marketBlocks").doc(context.uid).collection("blocked").doc(handle.data().uid).get();
    if (blocked.exists) return json(404, { error: "Creator not found." });
    const creatorSnap = await db.collection("marketCreators").doc(handle.data().uid).get();
    if (!creatorSnap.exists || creatorSnap.data().status !== "approved") return json(404, { error: "Creator not found." });
    const d = creatorSnap.data();
    return json(200, { creator: {
      uid: handle.data().uid, username: d.username, displayName: d.displayName || d.username,
      bio: d.bio || "", category: d.category || "Creator",
      avatarUrl: d.avatarPreviewUrl || "", verified: d.verified === true
    }, listings: [] });
  } catch (error) {
    console.error("Market creator profile failed:", error.message);
    return json(500, { error: "Unable to load this creator." });
  }
};
