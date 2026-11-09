const { json, parseBody } = require("./_market-auth");
const { loadEligibleUser, cleanText } = require("./_market-data");

exports.handler = async event => {
  if (!["GET", "POST"].includes(event.httpMethod)) return json(405, { error: "Method not allowed" }, { Allow: "GET, POST" });
  try {
    const context = await loadEligibleUser(event);
    if (context.error) return context.error;
    const db = context.admin.firestore();
    const collection = db.collection("marketBlocks").doc(context.uid).collection("blocked");
    if (event.httpMethod === "GET") {
      const snap = await collection.get();
      return json(200, { blockedUids: snap.docs.map(d => d.id) });
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
