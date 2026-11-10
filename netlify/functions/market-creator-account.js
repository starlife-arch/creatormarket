const { json } = require("./_market-auth");
const { loadEligibleUser } = require("./_market-data");
const { adminFailure } = require("./_market-admin-error");

exports.handler = async event => {
  if (event.httpMethod !== "GET") return json(405, { error: "Method not allowed" }, { Allow: "GET" });
  try {
    const context = await loadEligibleUser(event);
    if (context.error) return context.error;
    const db = context.admin.firestore();
    const creator = await db.collection("marketCreators").doc(context.uid).get();
    if (!creator.exists || creator.data().status !== "approved") return json(403, { error: "An approved creator account is required." });
    const balanceRef = db.collection("marketCreatorBalances").doc(context.uid);
    // Read by creatorUid only, then sort locally to avoid an un-deployed composite index.
    const historyQuery = db.collection("marketCreatorWithdrawals").where("creatorUid", "==", context.uid).limit(100);
    const [balance, history] = await Promise.all([balanceRef.get(), historyQuery.get()]);
    const b = balance.data() || {};
    const withdrawals = [...history.docs].sort((a,b) => (b.data().createdAt?.toMillis?.() || 0) - (a.data().createdAt?.toMillis?.() || 0)).slice(0,50);
    return json(200, {
      availableTokens: Number(b.availableTokens || 0), reservedTokens: Number(b.reservedTokens || 0),
      lifetimeEarnedTokens: Number(b.lifetimeEarnedTokens || 0), lifetimeWithdrawnTokens: Number(b.lifetimeWithdrawnTokens || 0),
      withdrawals: withdrawals.map(doc => {
        const d = doc.data();
        return { id: doc.id, amountTokens: d.amountTokens, method: d.method, status: d.status, createdAt: d.createdAt?.toDate ? d.createdAt.toDate().toISOString() : null, reviewNote: d.reviewNote || "" };
      })
    });
  } catch (error) {
    return adminFailure(error, "Unable to load creator earnings.");
  }
};
