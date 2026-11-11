const { json, parseBody, getAdmin, getMarketUser } = require("./_market-auth");
const { cleanText, isAdmin } = require("./_market-data");
const { adminFailure } = require("./_market-admin-error");

exports.handler = async event => {
  if (!["GET", "POST"].includes(event.httpMethod)) return json(405, { error: "Method not allowed" }, { Allow: "GET, POST" });
  try {
    const auth = getMarketUser(event);
    if (auth.error) return auth.error;
    const admin = getAdmin(), db = admin.firestore();
    const adminSnap = await db.collection("users").doc(auth.uid).get();
    if (!adminSnap.exists || !isAdmin(adminSnap.data())) return json(403, { error: "Administrator access required." });

    if (event.httpMethod === "GET") {
      const [usersSnap, creatorsSnap, listingsSnap, balancesSnap, entitlementsSnap, purchasesSnap] = await Promise.all([
        db.collection("users").limit(500).get(),
        db.collection("marketCreators").limit(300).get(),
        db.collection("marketListings").limit(500).get(),
        db.collection("marketCreatorBalances").limit(300).get(),
        db.collection("marketEntitlements").limit(1000).get(),
        db.collection("marketPurchases").limit(1000).get()
      ]);
      const balances = new Map(balancesSnap.docs.map(d => [d.id, d.data()]));
      const creators = creatorsSnap.docs.map(doc => {
        const d = doc.data(), b = balances.get(doc.id) || {};
        return { uid: doc.id, username: d.username || "", displayName: d.displayName || d.username || "Creator",
          status: d.status || "unknown", category: d.category || "", verified: d.verified === true,
          avatarUrl: d.avatarPreviewUrl || d.avatarUrl || "",
          availableTokens: Number(b.availableTokens || 0), reservedTokens: Number(b.reservedTokens || 0),
          lifetimeEarnedTokens: Number(b.lifetimeEarnedTokens || 0), lifetimeWithdrawnTokens: Number(b.lifetimeWithdrawnTokens || 0) };
      });
      const marketUserIds = new Set();
      creators.forEach(c => marketUserIds.add(c.uid));
      listingsSnap.docs.forEach(d => { const uid = d.data().creatorUid; if (uid) marketUserIds.add(uid); });
      entitlementsSnap.docs.forEach(d => { const uid = d.data().buyerUid; if (uid) marketUserIds.add(uid); });
      purchasesSnap.docs.forEach(d => { const uid = d.data().buyerUid; if (uid) marketUserIds.add(uid); });
      usersSnap.docs.forEach(d => {
        const u = d.data();
        if (u.marketAgeVerified === true || u.marketAgeVerificationStatus || u.marketCreatorApplication || u.marketCreatorIdentityVerified === true) marketUserIds.add(d.id);
      });
      const users = usersSnap.docs.filter(d => marketUserIds.has(d.id)).map(doc => {
        const d = doc.data();
        return { uid: doc.id, displayName: d.displayName || d.name || "Member",
          marketAgeVerified: d.marketAgeVerified === true, creatorIdentityVerified: d.marketCreatorIdentityVerified === true,
          banned: d.marketBanned === true, suspended: d.marketSuspended === true };
      });
      const creatorMap = new Map(creators.map(c => [c.uid, c]));
      const listings = listingsSnap.docs.map(doc => {
        const d = doc.data(), creator = creatorMap.get(d.creatorUid) || {};
        return { id: doc.id, title: d.title || "Untitled listing", description: d.description || "",
          status: d.status || "unknown", mediaKind: d.mediaKind || (d.mediaResourceType === "video" ? "video" : "image"),
          mediaProvider: d.mediaProvider || "", creatorUid: d.creatorUid || "", creatorUsername: creator.username || d.creatorUsername || "",
          creatorName: creator.displayName || "", creatorAvatarUrl: creator.avatarUrl || "", offers: (Array.isArray(d.offers) ? d.offers : []).map(o => ({ label: String(o?.label || o?.type || "Access"), priceTokens: Number(o?.priceTokens || 0) })) };
      }).sort((a,b) => String(a.title || "").localeCompare(String(b.title || "")));
      return json(200, { users, creators, listings });
    }

    const body = parseBody(event), action = cleanText(body.action, 40);
    const targetId = cleanText(body.targetId, 128), note = cleanText(body.note, 500);
    if (!targetId || note.length < 8) return json(400, { error: "Select a target and enter an audit note of at least 8 characters." });
    const now = admin.firestore.FieldValue.serverTimestamp();
    if (action === "ban_creator" || action === "unban_creator") {
      const ref = db.collection("marketCreators").doc(targetId);
      const snap = await ref.get();
      if (!snap.exists) return json(404, { error: "Creator profile not found." });
      const status = action === "ban_creator" ? "suspended" : "approved";
      await ref.update({ status, moderationNote: note, updatedAt: now });
      await db.collection("marketAdminAudit").add({ actorUid: auth.uid, action, targetUid: targetId, reason: note, createdAt: now });
      return json(200, { ok: true, status });
    }
    if (action === "hide_listing" || action === "restore_listing" || action === "delete_listing") {
      const ref = db.collection("marketListings").doc(targetId), snap = await ref.get();
      if (!snap.exists) return json(404, { error: "Listing not found." });
      const status = action === "restore_listing" ? "published" : action === "delete_listing" ? "deleted" : "hidden";
      await ref.update({ status, moderationNote: note, updatedAt: now });
      await db.collection("marketAdminAudit").add({ actorUid: auth.uid, action, targetUid: snap.data().creatorUid || "", targetId, reason: note, createdAt: now });
      return json(200, { ok: true, status });
    }
    return json(400, { error: "Unsupported Market administration action." });
  } catch (error) {
    return adminFailure(error, "Unable to load or update Market operations.");
  }
};
