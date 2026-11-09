const { json } = require("./_market-auth");
const { loadEligibleUser, cleanText } = require("./_market-data");

exports.handler = async event => {
  if (event.httpMethod !== "GET") return json(405, { error: "Method not allowed" }, { Allow: "GET" });
  try {
    const context = await loadEligibleUser(event);
    if (context.error) return context.error;
    const q = cleanText(event.queryStringParameters?.q || "", 40).toLowerCase().replace(/^@/, "");
    const db = context.admin.firestore();
    let query = db.collection("marketCreators").where("status", "==", "approved").orderBy("usernameLower").limit(30);
    if (q) query = db.collection("marketCreators").where("status", "==", "approved")
      .orderBy("usernameLower").startAt(q).endAt(q + "\uf8ff").limit(30);
    const snap = await query.get();
    const blockedSnap = await db.collection("marketBlocks").doc(context.uid).collection("blocked").get();
    const blocked = new Set(blockedSnap.docs.map(doc => doc.id));
    const creators = snap.docs.filter(doc => !blocked.has(doc.id)).map(doc => {
      const d = doc.data();
      return {
        uid: doc.id,
        username: d.username,
        displayName: d.displayName || d.username,
        bio: d.bio || "",
        avatarUrl: d.avatarPreviewUrl || "",
        category: d.category || "Creator",
        verified: d.verified === true
      };
    });
    return json(200, { creators });
  } catch (error) {
    console.error("Market creator search failed:", error.message);
    return json(500, { error: "Unable to search creators right now." });
  }
};
