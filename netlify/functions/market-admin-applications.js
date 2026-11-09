const { json, parseBody, getAdmin } = require("./_market-auth");
const { getMarketUser, cleanText, validUsername, isAdmin } = require("./_market-data");

exports.handler = async event => {
  if (!["GET", "POST"].includes(event.httpMethod)) return json(405, { error: "Method not allowed" }, { Allow: "GET, POST" });
  try {
    const auth = getMarketUser(event);
    if (auth.error) return auth.error;
    const admin = getAdmin();
    const db = admin.firestore();
    const adminSnap = await db.collection("users").doc(auth.uid).get();
    if (!adminSnap.exists || !isAdmin(adminSnap.data())) return json(403, { error: "Administrator access required." });
    const apps = db.collection("marketCreatorApplications");
    if (event.httpMethod === "GET") {
      const snap = await apps.where("status", "==", "pending").orderBy("createdAt", "asc").limit(50).get();
      return json(200, { applications: snap.docs.map(doc => {
        const d = doc.data();
        return { uid: doc.id, username: d.username, displayName: d.displayName, bio: d.bio, category: d.category, createdAt: d.createdAt?.toDate ? d.createdAt.toDate().toISOString() : null };
      })});
    }
    const body = parseBody(event);
    const uid = cleanText(body.uid, 128);
    const decision = body.decision;
    const note = cleanText(body.note, 500);
    if (!uid || !["approve", "reject"].includes(decision)) return json(400, { error: "A valid application and decision are required." });
    const appRef = apps.doc(uid);
    const appSnap = await appRef.get();
    if (!appSnap.exists || appSnap.data().status !== "pending") return json(409, { error: "This application is no longer pending." });
    const app = appSnap.data();
    if (decision === "reject") {
      await appRef.update({ status: "rejected", reviewNote: note, reviewedAt: admin.firestore.FieldValue.serverTimestamp(), reviewedBy: auth.uid, updatedAt: admin.firestore.FieldValue.serverTimestamp() });
      await db.collection("marketAdminAudit").add({ actorUid: auth.uid, action: "creator_application_rejected", targetUid: uid, reason: note, createdAt: admin.firestore.FieldValue.serverTimestamp() });
      return json(200, { ok: true, status: "rejected" });
    }
    const applicantSnap = await db.collection("users").doc(uid).get();
    const applicant = applicantSnap.exists ? applicantSnap.data() || {} : {};
    if (applicant.marketAgeVerified !== true || applicant.marketCreatorIdentityVerified !== true) {
      return json(403, { error: "Creator approval requires separately verified 18+ age and creator identity. Complete those checks before approving." });
    }
    const username = String(app.username || "").toLowerCase();
    if (!validUsername(username)) return json(409, { error: "The requested username is invalid. Ask the creator to apply again." });
    const handleRef = db.collection("marketCreatorHandles").doc(username);
    const creatorRef = db.collection("marketCreators").doc(uid);
    await db.runTransaction(async tx => {
      const [freshApp, handleSnap] = await Promise.all([tx.get(appRef), tx.get(handleRef)]);
      if (!freshApp.exists || freshApp.data().status !== "pending") throw new Error("APPLICATION_NOT_PENDING");
      if (handleSnap.exists && handleSnap.data().uid !== uid) throw new Error("USERNAME_TAKEN");
      const a = freshApp.data();
      tx.set(handleRef, { uid, username, createdAt: admin.firestore.FieldValue.serverTimestamp() });
      tx.set(creatorRef, {
        uid, username, usernameLower: username, displayName: a.displayName,
        bio: a.bio, category: a.category || "Other", status: "approved",
        verified: false, createdAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      });
      tx.update(appRef, { status: "approved", reviewedAt: admin.firestore.FieldValue.serverTimestamp(), reviewedBy: auth.uid, reviewNote: note, updatedAt: admin.firestore.FieldValue.serverTimestamp() });
      tx.create(db.collection("marketAdminAudit").doc(), { actorUid: auth.uid, action: "creator_application_approved", targetUid: uid, targetId: username, reason: note, createdAt: admin.firestore.FieldValue.serverTimestamp() });
    });
    return json(200, { ok: true, status: "approved", username });
  } catch (error) {
    if (error.message === "USERNAME_TAKEN") return json(409, { error: "That username is already in use. Ask the creator to choose another." });
    if (error.message === "APPLICATION_NOT_PENDING") return json(409, { error: "This application is no longer pending." });
    console.error("Market admin application review failed:", error.message);
    return json(500, { error: "Unable to review this application." });
  }
};
