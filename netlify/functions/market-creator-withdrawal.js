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
    const requestId = cleanText(body.requestId, 64);
    if (!Number.isSafeInteger(amountTokens) || amountTokens < 3000) return json(400, { error: "The minimum creator withdrawal is 3,000 earning tokens." });
    if (!METHODS.includes(method) || details.length < 5) return json(400, { error: "Choose a payout method and provide valid payout details." });
    if (!/^[A-Za-z0-9_-]{16,64}$/.test(requestId)) return json(400, { error: "A valid withdrawal request reference is required. Please refresh Studio and try again." });

    const db = context.admin.firestore();
    const balanceRef = db.collection("marketCreatorBalances").doc(context.uid);
    // A stable client request ID makes retries safe when the network or UI fails after commit.
    const withdrawalRef = db.collection("marketCreatorWithdrawals").doc(context.uid + "_" + requestId);
    const result = await db.runTransaction(async tx => {
      const priorSnap = await tx.get(withdrawalRef);
      if (priorSnap.exists) {
        const prior = priorSnap.data();
        if (prior.creatorUid !== context.uid || Number(prior.amountTokens) !== amountTokens || prior.method !== method || prior.payoutDetails !== details) {
          throw new Error("WITHDRAWAL_REQUEST_ID_CONFLICT");
        }
        return { duplicate: true, withdrawalId: withdrawalRef.id, status: prior.status || "pending" };
      }
      const balanceSnap = await tx.get(balanceRef);
      const balance = Number(balanceSnap.data()?.availableTokens || 0);
      if (!balanceSnap.exists || balance < amountTokens) throw new Error("INSUFFICIENT_EARNINGS");
      tx.update(balanceRef, { availableTokens: balance - amountTokens, reservedTokens: context.admin.firestore.FieldValue.increment(amountTokens), updatedAt: context.admin.firestore.FieldValue.serverTimestamp() });
      tx.create(withdrawalRef, {
        creatorUid: context.uid, amountTokens, method, payoutDetails: details,
        requestId, status: "pending", createdAt: context.admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: context.admin.firestore.FieldValue.serverTimestamp()
      });
      tx.set(db.collection("marketCreatorLedger").doc(context.uid).collection("entries").doc(withdrawalRef.id), {
        type: "withdrawal_reserved", withdrawalId: withdrawalRef.id, amountTokens,
        createdAt: context.admin.firestore.FieldValue.serverTimestamp()
      });
      return { duplicate: false, withdrawalId: withdrawalRef.id, status: "pending" };
    });
    return json(result.duplicate ? 200 : 201, { ok: true, ...result });
  } catch (error) {
    if (error.message === "INSUFFICIENT_EARNINGS") return json(402, { error: "Your available creator earnings are below the requested amount." });
    if (error.message === "WITHDRAWAL_REQUEST_ID_CONFLICT") return json(409, { error: "This withdrawal reference was already used for different details. Please refresh Studio before submitting a changed request." });
    console.error("Market creator withdrawal request failed:", error.message);
    return json(500, { error: "Unable to submit your withdrawal request." });
  }
};
