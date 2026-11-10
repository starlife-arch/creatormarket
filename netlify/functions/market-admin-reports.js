const { json, parseBody, getAdmin } = require("./_market-auth");
const { getMarketUser, cleanText, isAdmin } = require("./_market-data");

exports.handler = async event => {
  if (!["GET", "POST"].includes(event.httpMethod)) return json(405, { error: "Method not allowed" }, { Allow: "GET, POST" });
  try {
    const auth = getMarketUser(event);
    if (auth.error) return auth.error;
    const admin = getAdmin(), db = admin.firestore();
    const adminSnap = await db.collection("users").doc(auth.uid).get();
    if (!adminSnap.exists || !isAdmin(adminSnap.data())) return json(403, { error: "Administrator access required." });
    if (event.httpMethod === "GET") {
      const snap = await db.collection("marketReports").where("status", "==", "pending").limit(250).get();
      const orderedDocs = [...snap.docs].sort((a,b) => (a.data().createdAt?.toMillis?.() || 0) - (b.data().createdAt?.toMillis?.() || 0)).slice(0,100);
      return json(200, { reports: orderedDocs.map(doc => {
        const d = doc.data();
        return { id: doc.id, reporterUid: d.reporterUid, targetType: d.targetType, targetId: d.targetId, targetUid: d.targetUid, reason: d.reason, createdAt: d.createdAt?.toDate ? d.createdAt.toDate().toISOString() : null };
      })});
    }
    const body = parseBody(event);
    const reportId = cleanText(body.reportId, 128), action = body.action, note = cleanText(body.note, 500);
    if (!reportId || !["hide_listing", "suspend_creator", "restore_listing", "resolve", "dismiss"].includes(action)) return json(400, { error: "A report and valid moderation action are required." });
    const reportRef = db.collection("marketReports").doc(reportId);
    await db.runTransaction(async tx => {
      const reportSnap = await tx.get(reportRef);
      if (!reportSnap.exists || reportSnap.data().status !== "pending") throw new Error("REPORT_NOT_PENDING");
      const report = reportSnap.data();
      let targetRef = null, targetSnap = null;
      if (action === "hide_listing" || action === "restore_listing") {
        if (report.targetType !== "listing") throw new Error("ACTION_TARGET_MISMATCH");
        targetRef = db.collection("marketListings").doc(report.targetId);
        targetSnap = await tx.get(targetRef);
        if (!targetSnap.exists) throw new Error("TARGET_NOT_FOUND");
      }
      if (action === "suspend_creator") {
        targetRef = db.collection("marketCreators").doc(report.targetUid);
        targetSnap = await tx.get(targetRef);
        if (!targetSnap.exists) throw new Error("TARGET_NOT_FOUND");
      }
      if (targetRef && action === "hide_listing") tx.update(targetRef, { status: "hidden", updatedAt: admin.firestore.FieldValue.serverTimestamp() });
      if (targetRef && action === "restore_listing") tx.update(targetRef, { status: "published", updatedAt: admin.firestore.FieldValue.serverTimestamp() });
      if (targetRef && action === "suspend_creator") tx.update(targetRef, { status: "suspended", suspendedAt: admin.firestore.FieldValue.serverTimestamp(), updatedAt: admin.firestore.FieldValue.serverTimestamp() });
      tx.update(reportRef, { status: action === "dismiss" ? "dismissed" : "reviewed", moderationAction: action, moderationNote: note, reviewedBy: auth.uid, reviewedAt: admin.firestore.FieldValue.serverTimestamp() });
      tx.create(db.collection("marketAdminAudit").doc(), {
        actorUid: auth.uid, action, targetType: report.targetType, targetId: report.targetId,
        targetUid: report.targetUid, reportId, reason: note,
        createdAt: admin.firestore.FieldValue.serverTimestamp()
      });
    });
    return json(200, { ok: true, action });
  } catch (error) {
    if (error.message === "REPORT_NOT_PENDING") return json(409, { error: "This report has already been reviewed." });
    if (error.message === "ACTION_TARGET_MISMATCH") return json(400, { error: "That action does not match the reported item." });
    if (error.message === "TARGET_NOT_FOUND") return json(404, { error: "The reported item no longer exists." });
    console.error("Market moderation failed:", error.code || "UNKNOWN", error.message, error.stack);
    return json(500, { error: "Unable to complete the moderation action." });
  }
};
