const { json, parseBody } = require("./_market-auth");
const { loadEligibleUser, cleanText } = require("./_market-data");

exports.handler = async event => {
  if (event.httpMethod !== "POST") return json(405, { error: "Method not allowed" }, { Allow: "POST" });
  try {
    const context = await loadEligibleUser(event);
    if (context.error) return context.error;
    const body = parseBody(event);
    const targetType = body.targetType;
    const targetId = cleanText(body.targetId, 128);
    const reason = cleanText(body.reason, 1000);
    if (!["creator", "listing"].includes(targetType) || !targetId || reason.length < 12) return json(400, { error: "Choose a creator or listing and explain the concern in at least 12 characters." });
    const db = context.admin.firestore();
    let targetUid = targetId;
    if (targetType === "listing") {
      const listing = await db.collection("marketListings").doc(targetId).get();
      if (!listing.exists) return json(404, { error: "Listing not found." });
      targetUid = listing.data().creatorUid;
    } else {
      const creator = await db.collection("marketCreators").doc(targetId).get();
      if (!creator.exists) return json(404, { error: "Creator not found." });
    }
    if (targetUid === context.uid) return json(400, { error: "You cannot report your own creator page." });
    const ref = db.collection("marketReports").doc();
    await ref.set({
      reporterUid: context.uid, targetType, targetId, targetUid, reason,
      status: "pending", createdAt: context.admin.firestore.FieldValue.serverTimestamp()
    });
    return json(201, { ok: true, reportId: ref.id, message: "Your report has been sent to the Market moderation team." });
  } catch (error) {
    console.error("Market report submission failed:", error.message);
    return json(500, { error: "Unable to submit your report." });
  }
};
