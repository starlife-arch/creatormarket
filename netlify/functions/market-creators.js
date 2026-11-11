const { json } = require("./_market-auth");
const { loadEligibleUser, cleanText } = require("./_market-data");

exports.handler = async event => {
  if (event.httpMethod !== "GET") return json(405, { error: "Method not allowed" }, { Allow: "GET" });
  try {
    const context = await loadEligibleUser(event);
    if (context.error) return context.error;
    const q = cleanText(event.queryStringParameters?.q || "", 40).toLowerCase().replace(/^@/, "");
    const db = context.admin.firestore();
    // Use only the status equality filter here. Sorting and prefix filtering in
    // memory avoids a composite-index deployment race that otherwise returns 500.
    const snap = await db.collection("marketCreators").where("status", "==", "approved").limit(500).get();
    const blockedSnap = await db.collection("marketBlocks").doc(context.uid).collection("blocked").limit(500).get();
    const blocked = new Set(blockedSnap.docs.map(doc => doc.id));
    const creators = snap.docs.map(doc => {
      const d = doc.data();
      return { uid: doc.id, username: d.username || "", usernameLower: d.usernameLower || String(d.username || "").toLowerCase(),
        displayName: d.displayName || d.username || "Creator", bio: d.bio || "",
        avatarUrl: d.avatarPreviewUrl || "", category: d.category || "Creator", verified: d.verified === true };
    }).filter(c => !blocked.has(c.uid) && (!q || c.usernameLower.startsWith(q)))
      .sort((a,b)=>a.usernameLower.localeCompare(b.usernameLower)).slice(0,30)
      .map(({usernameLower,...creator})=>creator);
    return json(200, { creators });
  } catch (error) {
    console.error("Market creator search failed:", { message:error.message, code:error.code, stack:error.stack });
    return json(500, { error: "Unable to search creators right now. Please retry shortly." });
  }
};
