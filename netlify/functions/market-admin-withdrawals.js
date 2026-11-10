const { json, parseBody, getAdmin } = require("./_market-auth");
const { adminFailure } = require("./_market-admin-error");
const { getMarketUser, cleanText, isAdmin } = require("./_market-data");

exports.handler = async event => {
  if (!["GET", "POST"].includes(event.httpMethod)) return json(405, { error: "Method not allowed" }, { Allow: "GET, POST" });
  try {
    const auth = getMarketUser(event);
    if (auth.error) return auth.error;
    const admin = getAdmin();
    const db = admin.firestore();
    const adminSnap = await db.collection("users").doc(auth.uid).get();
    if (!adminSnap.exists || !isAdmin(adminSnap.data())) return json(403, { error: "Administrator access required." });
    if (event.httpMethod === "GET") {
      const snap = await db.collection("marketCreatorWithdrawals").where("status", "==", "pending").limit(250).get();
      const orderedDocs = [...snap.docs].sort((a,b) => (a.data().createdAt?.toMillis?.() || 0) - (b.data().createdAt?.toMillis?.() || 0)).slice(0,50);
      return json(200, { withdrawals: orderedDocs.map(doc => {
        const d = doc.data();
        return { id: doc.id, creatorUid: d.creatorUid, amountTokens: d.amountTokens, method: d.method, payoutDetails: d.payoutDetails, createdAt: d.createdAt?.toDate ? d.createdAt.toDate().toISOString() : null };
      })});
    }
    const body = parseBody(event);
    const id = cleanText(body.withdrawalId, 128);
    const decision = body.decision;
    const note = cleanText(body.note, 500);
    if (!id || !["paid", "reject"].includes(decision)) return json(400, { error: "A withdrawal and valid decision are required." });
    const withdrawalRef = db.collection("marketCreatorWithdrawals").doc(id);
    await db.runTransaction(async tx => {
      const w = await tx.get(withdrawalRef);
      if (!w.exists || w.data().status !== "pending") throw new Error("WITHDRAWAL_NOT_PENDING");
      const data = w.data();
      const balanceRef = db.collection("marketCreatorBalances").doc(data.creatorUid);
      const balance = await tx.get(balanceRef);
      if (!balance.exists) throw new Error("CREATOR_BALANCE_MISSING");
      const reserved = Number(balance.data().reservedTokens || 0);
      const amount = Number(data.amountTokens || 0);
      if (reserved < amount) throw new Error("RESERVATION_MISMATCH");
      if (decision === "reject") {
        tx.update(balanceRef, { availableTokens: Number(balance.data().availableTokens || 0) + amount, reservedTokens: reserved - amount, updatedAt: admin.firestore.FieldValue.serverTimestamp() });
      } else {
        tx.update(balanceRef, { reservedTokens: reserved - amount, lifetimeWithdrawnTokens: admin.firestore.FieldValue.increment(amount), updatedAt: admin.firestore.FieldValue.serverTimestamp() });
      }
      tx.update(withdrawalRef, { status: decision === "paid" ? "paid" : "rejected", reviewNote: note, reviewedBy: auth.uid, reviewedAt: admin.firestore.FieldValue.serverTimestamp(), updatedAt: admin.firestore.FieldValue.serverTimestamp() });
      tx.create(db.collection("marketAdminAudit").doc(), { actorUid: auth.uid, action: decision === "paid" ? "creator_withdrawal_paid" : "creator_withdrawal_rejected", targetUid: data.creatorUid, targetId: id, amountTokens: amount, reason: note, createdAt: admin.firestore.FieldValue.serverTimestamp() });
      tx.set(db.collection("marketCreatorLedger").doc(data.creatorUid).collection("entries").doc(id + "_review"), { type: decision === "paid" ? "withdrawal_paid" : "withdrawal_released", withdrawalId: id, amountTokens: amount, reviewedBy: auth.uid, createdAt: admin.firestore.FieldValue.serverTimestamp() });
    });
    return json(200, { ok: true, status: decision === "paid" ? "paid" : "rejected" });
  } catch (error) {
    if (error.message === "WITHDRAWAL_NOT_PENDING") return json(409, { error: "This withdrawal is no longer pending." });
    if (["CREATOR_BALANCE_MISSING", "RESERVATION_MISMATCH"].includes(error.message)) return json(409, { error: "The creator earnings reservation does not match. Please investigate before changing this request." });
    return adminFailure(error, "Unable to review this withdrawal.");
  }
};
