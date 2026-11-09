const { json, parseBody } = require("./_market-auth");
const { loadMarketUser, cleanText } = require("./_market-data");

exports.handler = async event => {
  if (!["GET", "POST"].includes(event.httpMethod)) return json(405, { error: "Method not allowed" }, { Allow: "GET, POST" });
  try {
    // Blocking is a normal account safety control, not access to creator media.
    const context = await loadMarketUser(event);
    if (context.error) return context.error;
    const db = context.admin.firestore();
    const collection = db.collection("marketBlocks").doc(context.uid).collection("blocked");
    if (event.httpMethod === "GET") {
      const snap = await collection.limit(100).get();
      const blockedCreators = await Promise.all(snap.docs.map(async doc => {
        const creator = await db.collection("marketCreators").doc(doc.id).get();
        const data = creator.data() || {};
        return { uid: doc.id, username: data.username || "", displayName: data.displayName || data.username || "Creator" };
      }));
      return json(200, { blockedUids: snap.docs.map(d => d.id), blockedCreators });
    }
    const body = parseBody(event);
    const targetUid = cleanText(body.targetUid, 128);
    const action = body.action;
    if (!targetUid || targetUid === context.uid || !["block", "unblock"].includes(action)) return json(400, { error: "Choose a valid creator and block action." });
    const ref = collection.doc(targetUid);
    if (action === "block") await ref.set({ targetUid, createdAt: context.admin.firestore.FieldValue.serverTimestamp() });
    else await ref.delete();
    return json(200, { ok: true, action });
  } catch (error) {
    console.error("Market block action failed:", error.message);
    return json(500, { error: "Unable to update your blocked creators." });
  }
};
