const { json, parseBody } = require("./_market-auth");
const { loadEligibleUser, cleanText } = require("./_market-data");

const METHODS = ["M-Pesa", "Bank", "PayPal"];
exports.handler = async event => {
  if (event.httpMethod !== "POST") return json(405, { error: "Method not allowed" }, { Allow: "POST" });
  try {
    const context = await loadEligibleUser(event);
    if (context.error) return context.error;
    const creator = await context.admin.firestore().collection("marketCreators").doc(context.uid).get();
    if (!creator.exists || creator.data().status !== "approved" || context.profile.marketCreatorIdentityVerified !== true) return json(403, { error: "An approved, identity-verified creator account is required." });
    const body = parseBody(event);
    const amountTokens = Math.floor(Number(body.amountTokens));
    const method = cleanText(body.method, 30);
    const details = cleanText(body.details, 300);
    if (!Number.isSafeInteger(amountTokens) || amountTokens < 3000) return json(400, { error: "The minimum creator withdrawal is 3,000 earning tokens." });
    if (!METHODS.includes(method) || details.length < 5) return json(400, { error: "Choose a payout method and provide valid payout details." });
    const db = context.admin.firestore();
    const balanceRef = db.collection("marketCreatorBalances").doc(context.uid);
    const withdrawalRef = db.collection("marketCreatorWithdrawals").doc();
    await db.runTransaction(async tx => {
      const balanceSnap = await tx.get(balanceRef);
      const balance = Number(balanceSnap.data()?.availableTokens || 0);
      if (!balanceSnap.exists || balance < amountTokens) throw new Error("INSUFFICIENT_EARNINGS");
      tx.update(balanceRef, { availableTokens: balance - amountTokens, reservedTokens: context.admin.firestore.FieldValue.increment(amountTokens), updatedAt: context.admin.firestore.FieldValue.serverTimestamp() });
      tx.create(withdrawalRef, {
        creatorUid: context.uid, amountTokens, method, payoutDetails: details,
        status: "pending", createdAt: context.admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: context.admin.firestore.FieldValue.serverTimestamp()
      });
      tx.set(db.collection("marketCreatorLedger").doc(context.uid).collection("entries").doc(withdrawalRef.id), {
        type: "withdrawal_reserved", withdrawalId: withdrawalRef.id, amountTokens,
        createdAt: context.admin.firestore.FieldValue.serverTimestamp()
      });
    });
    return json(201, { ok: true, withdrawalId: withdrawalRef.id, status: "pending" });
  } catch (error) {
    if (error.message === "INSUFFICIENT_EARNINGS") return json(402, { error: "Your available creator earnings are below the requested amount." });
    console.error("Market creator withdrawal request failed:", error.message);
    return json(500, { error: "Unable to submit your withdrawal request." });
  }
};
