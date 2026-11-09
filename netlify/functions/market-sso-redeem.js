const crypto = require("crypto");
const {
  getAdmin, originAllowed, json, parseBody, signSession, sessionCookie
} = require("./_market-auth");

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return { statusCode: 204, headers: { "Cache-Control": "no-store" }, body: "" };
  if (event.httpMethod !== "POST") return json(405, { error: "Method not allowed" }, { Allow: "POST, OPTIONS" });
  const origin = event.headers?.origin || event.headers?.Origin;
  if (origin !== (process.env.MARKET_ORIGIN || "https://market.elysiandate.site")) return json(403, { error: "Origin not allowed" });

  try {
    const { code } = parseBody(event);
    if (typeof code !== "string" || code.length < 32 || code.length > 256) {
      return json(400, { error: "A valid SSO code is required" });
    }

    const admin = getAdmin();
    const db = admin.firestore();
    const codeHash = crypto.createHash("sha256").update(code).digest("hex");
    const codeRef = db.collection("creatorMarketSsoCodes").doc(codeHash);
    let uid = null;

    await db.runTransaction(async (tx) => {
      const snap = await tx.get(codeRef);
      if (!snap.exists) throw new Error("SSO_CODE_INVALID");
      const data = snap.data();
      const expiresAt = data.expiresAt?.toDate ? data.expiresAt.toDate().getTime() : new Date(data.expiresAt).getTime();
      if (data.audience !== "market.elysiandate.site" || data.consumedAt || !Number.isFinite(expiresAt) || expiresAt <= Date.now()) {
        throw new Error("SSO_CODE_INVALID");
      }
      if (typeof data.uid !== "string" || !data.uid) throw new Error("SSO_CODE_INVALID");
      uid = data.uid;
      tx.update(codeRef, { consumedAt: admin.firestore.FieldValue.serverTimestamp() });
    });

    const userSnap = await db.collection("users").doc(uid).get();
    if (!userSnap.exists || userSnap.data()?.banned === true || userSnap.data()?.suspended === true || userSnap.data()?.accountSuspended === true || userSnap.data()?.status === "rejected" || userSnap.data()?.status === "suspended") {
      return json(403, { error: "This account cannot access Creator Market" });
    }

    const token = signSession(uid);
    return json(200, { ok: true }, { "Set-Cookie": sessionCookie(token) });
  } catch (error) {
    if (error.message === "SSO_CODE_INVALID") return json(401, { error: "This sign-in link is invalid, expired, or already used" });
    console.error("Creator Market SSO redemption failed:", error.message);
    return json(500, { error: "Unable to complete sign-in" });
  }
};
