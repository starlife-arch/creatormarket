const crypto = require("crypto");
const { json, parseBody } = require("./_market-auth");
const { loadEligibleUser, cleanText } = require("./_market-data");

function expiryFor(offer, now) {
  if (offer.type === "permanent") return null;
  const date = new Date(now);
  if (offer.type === "timed") {
    const ms = offer.unit === "minute" ? 60000 : 3600000;
    return new Date(now + offer.value * ms);
  }
  if (offer.unit === "day") date.setUTCDate(date.getUTCDate() + offer.value);
  else if (offer.unit === "week") date.setUTCDate(date.getUTCDate() + offer.value * 7);
  else if (offer.unit === "month") date.setUTCMonth(date.getUTCMonth() + offer.value);
  else throw new Error("Unsupported rental duration.");
  return date;
}

exports.handler = async event => {
  if (event.httpMethod !== "POST") return json(405, { error: "Method not allowed" }, { Allow: "POST" });
  try {
    const context = await loadEligibleUser(event);
    if (context.error) return context.error;
    const body = parseBody(event);
    const listingId = cleanText(body.listingId, 128);
    const offerId = cleanText(body.offerId, 80);
    const idempotencyKey = cleanText(body.idempotencyKey, 100);
    if (!listingId || !offerId || !/^[a-zA-Z0-9_-]{12,100}$/.test(idempotencyKey)) return json(400, { error: "A listing, offer and unique purchase key are required." });
    const db = context.admin.firestore();
    const purchaseId = crypto.createHash("sha256").update(context.uid + ":" + idempotencyKey).digest("hex");
    const purchaseRef = db.collection("marketPurchases").doc(purchaseId);
    const listingRef = db.collection("marketListings").doc(listingId);
    const buyerRef = db.collection("users").doc(context.uid);
    let response;
    await db.runTransaction(async tx => {
      const [prior, listingSnap, buyerSnap] = await Promise.all([tx.get(purchaseRef), tx.get(listingRef), tx.get(buyerRef)]);
      if (prior.exists) { response = { ok: true, alreadyProcessed: true, purchaseId, entitlementId: prior.data().entitlementId }; return; }
      if (!listingSnap.exists || listingSnap.data().status !== "published") throw new Error("LISTING_UNAVAILABLE");
      if (!buyerSnap.exists) throw new Error("ACCOUNT_UNAVAILABLE");
      const listing = listingSnap.data();
      if (listing.creatorUid === context.uid) throw new Error("OWN_CONTENT");
      const offer = (Array.isArray(listing.offers) ? listing.offers : []).find(o => o.id === offerId);
      if (!offer || !Number.isSafeInteger(offer.priceTokens) || offer.priceTokens < 1) throw new Error("OFFER_UNAVAILABLE");
      const buyer = buyerSnap.data();
      if (buyer.walletFrozen || buyer.banned || buyer.suspended || buyer.accountSuspended) throw new Error("WALLET_HOLD");
      const balance = Math.floor(Number(buyer.walletBalance || 0));
      if (balance < offer.priceTokens) throw new Error("INSUFFICIENT_TOKENS");
      const creatorRef = db.collection("users").doc(listing.creatorUid);
      const creatorBalanceRef = db.collection("marketCreatorBalances").doc(listing.creatorUid);
      const [creatorSnap, creatorBalanceSnap] = await Promise.all([tx.get(creatorRef), tx.get(creatorBalanceRef)]);
      if (!creatorSnap.exists || creatorSnap.data().banned || creatorSnap.data().suspended || creatorSnap.data().accountSuspended) throw new Error("CREATOR_UNAVAILABLE");
      const gross = offer.priceTokens;
      const platformFee = Math.round(gross * 0.15);
      const creatorNet = gross - platformFee;
      const now = Date.now();
      const expiresAt = expiryFor(offer, now);
      const entitlementId = purchaseId;
      const entitlementRef = db.collection("marketEntitlements").doc(entitlementId);
      const walletTxRef = buyerRef.collection("walletTransactions").doc();
      const creatorLedgerRef = db.collection("marketCreatorLedger").doc(listing.creatorUid).collection("entries").doc(purchaseId);
      const platformLedgerRef = db.collection("marketPlatformLedger").doc(purchaseId);
      tx.update(buyerRef, { walletBalance: balance - gross });
      tx.create(purchaseRef, {
        buyerUid: context.uid, creatorUid: listing.creatorUid, listingId,
        offerId, offerType: offer.type, grossTokens: gross, platformFeeTokens: platformFee,
        creatorNetTokens: creatorNet, status: "completed",
        entitlementId, createdAt: context.admin.firestore.FieldValue.serverTimestamp()
      });
      tx.create(entitlementRef, {
        buyerUid: context.uid, creatorUid: listing.creatorUid, listingId, offerId,
        offerType: offer.type, startedAt: context.admin.firestore.Timestamp.fromMillis(now),
        expiresAt: expiresAt ? context.admin.firestore.Timestamp.fromDate(expiresAt) : null,
        downloadAllowed: listing.downloadAllowed === true, status: "active",
        purchaseId, createdAt: context.admin.firestore.FieldValue.serverTimestamp()
      });
      tx.set(walletTxRef, { type: "market_purchase", amount: gross, listingId, creatorUid: listing.creatorUid, note: "Creator Market purchase", status: "completed", createdAt: context.admin.firestore.FieldValue.serverTimestamp() });
      tx.set(creatorLedgerRef, { type: "sale_credit", purchaseId, listingId, buyerUid: context.uid, grossTokens: gross, platformFeeTokens: platformFee, netTokens: creatorNet, createdAt: context.admin.firestore.FieldValue.serverTimestamp() });
      tx.set(platformLedgerRef, { type: "market_commission", purchaseId, listingId, buyerUid: context.uid, creatorUid: listing.creatorUid, grossTokens: gross, platformFeeTokens: platformFee, creatorNetTokens: creatorNet, createdAt: context.admin.firestore.FieldValue.serverTimestamp() });
      tx.set(creatorBalanceRef, { availableTokens: (Number(creatorBalanceSnap.data()?.availableTokens || 0) + creatorNet), lifetimeEarnedTokens: context.admin.firestore.FieldValue.increment(creatorNet), updatedAt: context.admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
      response = { ok: true, alreadyProcessed: false, purchaseId, entitlementId, expiresAt: expiresAt ? expiresAt.toISOString() : null, chargedTokens: gross, creatorEarningTokens: creatorNet };
    });
    return json(200, response);
  } catch (error) {
    const messages = {
      LISTING_UNAVAILABLE: [404, "This listing is no longer available."],
      ACCOUNT_UNAVAILABLE: [403, "Your account could not be verified."],
      OWN_CONTENT: [400, "You cannot purchase your own listing."],
      OFFER_UNAVAILABLE: [400, "This access offer is no longer available."],
      WALLET_HOLD: [403, "Your wallet is currently on hold."],
      INSUFFICIENT_TOKENS: [402, "You do not have enough tokens for this offer."],
      CREATOR_UNAVAILABLE: [403, "This creator is currently unavailable."]
    };
    if (messages[error.message]) return json(messages[error.message][0], { error: messages[error.message][1] });
    console.error("Market purchase failed:", error.message);
    return json(500, { error: "Unable to complete this purchase." });
  }
};
