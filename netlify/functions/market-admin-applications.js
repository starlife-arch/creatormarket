const { json, parseBody } = require("./_market-auth");
const { getMarketUser, cleanText, validUsername, isAdmin } = require("./_market-data");

exports.handler = async event => {
  if (!["GET", "POST"].includes(event.httpMethod)) return json(405, { error: "Method not allowed" }, { Allow: "GET, POST" });
  try {
    const auth = getMarketUser(event);
    if (auth.error) return auth.error;
    const admin = require("firebase-admin");
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
    const actor = auth.uid;
    if (decision === "reject") {
      await appRef.update({ status: "rejected", reviewNote: note, reviewedAt: admin.firestore.FieldValue.serverTimestamp(), reviewedBy: actor, updatedAt: admin.firestore.FieldValue.serverTimestamp() });
      return json(200, { ok: true, status: "rejected" });
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
      tx.update(appRef, { status: "approved", reviewedAt: admin.firestore.FieldValue.serverTimestamp(), reviewedBy: actor, reviewNote: note, updatedAt: admin.firestore.FieldValue.serverTimestamp() });
    });
    return json(200, { ok: true, status: "approved", username });
  } catch (error) {
    if (error.message === "USERNAME_TAKEN") return json(409, { error: "That username is already in use. Ask the creator to choose another." });
    if (error.message === "APPLICATION_NOT_PENDING") return json(409, { error: "This application is no longer pending." });
    console.error("Market admin application review failed:", error.message);
    return json(500, { error: "Unable to review this application." });
  }
};
