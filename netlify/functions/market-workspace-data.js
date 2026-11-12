const { json, parseBody, getAdmin } = require("./_market-auth");
const { getMarketUser, loadMarketUser, cleanText, isAdmin } = require("./_market-data");

function iso(value) {
  if (value?.toDate) return value.toDate().toISOString();
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "string") return value;
  return null;
}
function millis(value) {
  if (value?.toMillis) return value.toMillis();
  if (value?.toDate) return value.toDate().getTime();
  return value ? new Date(value).getTime() || 0 : 0;
}
async function adminContext(event) {
  const auth = getMarketUser(event);
  if (auth.error) return { error: auth.error };
  const admin = getAdmin(), db = admin.firestore();
  const user = await db.collection("users").doc(auth.uid).get();
  if (!user.exists || !isAdmin(user.data())) return { error: json(403, { error: "Administrator access required." }) };
  return { uid: auth.uid, admin, db };
}
async function buyerData(context, cursor = "") {
  const db = context.admin.firestore();
  const userRef = db.collection("users").doc(context.uid);
  const user = await userRef.get();
  if (!user.exists) return json(403, { error: "Your DateVault account could not be verified." });
  let query = userRef.collection("walletTransactions").orderBy("createdAt", "desc").limit(50);
  if (cursor) {
    const cursorSnap = await userRef.collection("walletTransactions").doc(cursor).get();
    if (cursorSnap.exists) query = query.startAfter(cursorSnap);
  }
  const txSnap = await query.get();
  const d = user.data() || {};
  const transactions = txSnap.docs.map(doc => {
    const t = doc.data(), rawAmount = Number(t.amount || 0);
    return { id: doc.id, type: t.type || "wallet_activity", amount: t.type === "market_purchase" ? -Math.abs(rawAmount) : rawAmount,
      note: t.note || t.listingTitle || "Wallet activity", status: t.status || "completed",
      createdAt: iso(t.createdAt), listingId: t.listingId || null };
  });
  return json(200, { walletBalance: Number(d.walletBalance || 0), walletFrozen: d.walletFrozen === true,
    transactions, nextCursor: txSnap.docs.length === 50 ? txSnap.docs[txSnap.docs.length - 1].id : null,
    topUpUrl: "https://elysiandate.site/app/wallet/" });
}
async function creatorData(context) {
  const db = context.admin.firestore();
  const creator = await db.collection("marketCreators").doc(context.uid).get();
  if (!creator.exists || creator.data().status !== "approved" || context.profile.marketAgeVerified !== true || context.profile.marketCreatorIdentityVerified !== true) {
    return json(403, { error: "An approved, identity-verified creator account is required." });
  }
  const [balanceSnap, salesSnap, ledgerSnap, listingsSnap] = await Promise.all([
    db.collection("marketCreatorBalances").doc(context.uid).get(),
    db.collection("marketPurchases").where("creatorUid", "==", context.uid).limit(500).get(),
    db.collection("marketCreatorLedger").doc(context.uid).collection("entries").limit(500).get(),
    db.collection("marketListings").where("creatorUid", "==", context.uid).limit(100).get()
  ]);
  const balance = balanceSnap.data() || {};
  const sales = salesSnap.docs.map(doc => {
    const d = doc.data();
    return { id: doc.id, listingId: d.listingId || "", listingTitle: d.listingTitle || "Creator content",
      grossTokens: Number(d.grossTokens || 0), platformFeeTokens: Number(d.platformFeeTokens || 0),
      creatorNetTokens: Number(d.creatorNetTokens || 0), status: d.status || "completed", createdAt: iso(d.createdAt) };
  }).sort((a,b)=>millis(b.createdAt)-millis(a.createdAt));
  const listingStats = new Map();
  for (const listing of listingsSnap.docs) listingStats.set(listing.id, { listingId: listing.id, title: listing.data().title || "Untitled listing", status: listing.data().status || "unknown", sales: 0, grossTokens: 0, feeTokens: 0, netTokens: 0 });
  for (const sale of sales) {
    const stat = listingStats.get(sale.listingId);
    if (!stat) continue;
    stat.sales++;
    stat.grossTokens += sale.grossTokens;
    stat.feeTokens += sale.platformFeeTokens;
    stat.netTokens += sale.creatorNetTokens;
  }
  const ledger = ledgerSnap.docs.map(doc => {
    const d = doc.data();
    return { id: doc.id, type: d.type || "ledger_entry", amountTokens: Number(d.netTokens ?? d.amountTokens ?? 0),
      grossTokens: Number(d.grossTokens || 0), feeTokens: Number(d.platformFeeTokens || 0),
      createdAt: iso(d.createdAt), withdrawalId: d.withdrawalId || null };
  }).sort((a,b)=>millis(b.createdAt)-millis(a.createdAt));
  return json(200, {
    balance: { availableTokens: Number(balance.availableTokens || 0), reservedTokens: Number(balance.reservedTokens || 0),
      lifetimeEarnedTokens: Number(balance.lifetimeEarnedTokens || 0), lifetimeWithdrawnTokens: Number(balance.lifetimeWithdrawnTokens || 0) },
    performance: { totalSales: sales.length, grossTokens: sales.reduce((n,x)=>n+x.grossTokens,0),
      platformFeeTokens: sales.reduce((n,x)=>n+x.platformFeeTokens,0), creatorNetTokens: sales.reduce((n,x)=>n+x.creatorNetTokens,0),
      activeListings: [...listingStats.values()].filter(x=>x.status==="published").length },
    listings: [...listingStats.values()].sort((a,b)=>b.sales-a.sales),
    sales: sales.slice(0,200), ledger: ledger.slice(0,200)
  });
}
exports.handler = async event => {
  if (!["GET", "POST"].includes(event.httpMethod)) return json(405, { error: "Method not allowed" }, { Allow: "GET, POST" });
  try {
    const view = cleanText(event.queryStringParameters?.view || "", 40);
    if (event.httpMethod === "POST") {
      const context = await adminContext(event);
      if (context.error) return context.error;
      if (view !== "admin-settings") return json(400, { error: "Unsupported workspace action." });
      const body = parseBody(event);
      const settings = {
        creatorApplicationsEnabled: body.creatorApplicationsEnabled !== false,
        newListingsEnabled: body.newListingsEnabled !== false,
        announcement: cleanText(body.announcement || "", 240)
      };
      const ref = context.db.collection("marketSettings").doc("platform");
      await ref.set({ ...settings, updatedAt: context.admin.firestore.FieldValue.serverTimestamp(), updatedBy: context.uid }, { merge: true });
      await context.db.collection("marketAdminAudit").add({
        actorUid: context.uid, action: "platform_settings_updated",
        reason: "Updated creator application, listing and announcement settings",
        createdAt: context.admin.firestore.FieldValue.serverTimestamp()
      });
      return json(200, { ok: true, settings });
    }
    if (view === "admin-audit" || view === "admin-settings" || view === "admin-earnings") {
      const context = await adminContext(event);
      if (context.error) return context.error;
      if (view === "admin-settings") {
        const snap = await context.db.collection("marketSettings").doc("platform").get();
        const d = snap.exists ? snap.data() : {};
        return json(200, { settings: { creatorApplicationsEnabled: d.creatorApplicationsEnabled !== false,
          newListingsEnabled: d.newListingsEnabled !== false, announcement: d.announcement || "",
          updatedAt: iso(d.updatedAt), updatedBy: d.updatedBy || "" } });
      }
      if (view === "admin-earnings") {
        const ledgerSnap = await context.db.collection("marketPlatformLedger").limit(1000).get();
        const entries = ledgerSnap.docs.map(doc => {
          const d = doc.data();
          return { id: doc.id, listingId: d.listingId || "", creatorUid: d.creatorUid || "",
            buyerUid: d.buyerUid || "", grossTokens: Number(d.grossTokens || 0),
            platformFeeTokens: Number(d.platformFeeTokens || 0), creatorNetTokens: Number(d.creatorNetTokens || 0),
            createdAt: iso(d.createdAt) };
        }).sort((a,b)=>millis(b.createdAt)-millis(a.createdAt));
        return json(200, { summary: { completedSales: entries.length,
          grossTokens: entries.reduce((n,x)=>n+x.grossTokens,0),
          platformFeeTokens: entries.reduce((n,x)=>n+x.platformFeeTokens,0),
          creatorNetTokens: entries.reduce((n,x)=>n+x.creatorNetTokens,0) }, entries: entries.slice(0,300) });
      }
      const snap = await context.db.collection("marketAdminAudit").limit(500).get();
      const logs = snap.docs.map(doc => {
        const d = doc.data();
        return { id: doc.id, actorUid: d.actorUid || "", action: d.action || "admin_action",
          targetType: d.targetType || "", targetUid: d.targetUid || "", targetId: d.targetId || "",
          reason: d.reason || d.note || "", createdAt: iso(d.createdAt) };
      }).sort((a,b)=>millis(b.createdAt)-millis(a.createdAt)).slice(0,250);
      return json(200, { logs });
    }
    const context = await loadMarketUser(event);
    if (context.error) return context.error;
    if (view === "public-settings") {
      const snap = await context.admin.firestore().collection("marketSettings").doc("platform").get();
      return json(200, { announcement: snap.exists ? cleanText(snap.data().announcement || "", 240) : "" });
    }
    if (view === "buyer") return buyerData(context, cleanText(event.queryStringParameters?.cursor || "", 128));
    if (view === "creator") return creatorData(context);
    return json(400, { error: "Choose a valid workspace data view." });
  } catch (error) {
    console.error("Market workspace data failed:", error?.message || error, error?.stack || "");
    return json(500, { error: "Unable to load this workspace data. Please retry." });
  }
};
