const crypto = require("crypto");
const { json, originAllowed, getAdmin } = require("./_market-auth");
const { getMarketUser, isMarketAccountEligible } = require("./_market-data");

exports.handler = async event => {
  if (event.httpMethod === "OPTIONS") return { statusCode: 204, headers: { "Cache-Control": "no-store" }, body: "" };
  if (event.httpMethod !== "POST") return json(405, { error: "POST required" }, { Allow: "POST, OPTIONS" });
  if (!originAllowed(event)) return json(403, { error: "Origin not allowed" });
  try {
    const session = getMarketUser(event);
    if (session.error) return session.error;
    const admin = getAdmin();
    const db = admin.firestore();
    const userRef = db.collection("users").doc(session.uid);
    const userSnap = await userRef.get();
    if (!userSnap.exists) return json(403, { error: "Your Market account could not be verified." });
    if (!isMarketAccountEligible(userSnap.data() || {})) return json(403, { error: "This account is restricted from Creator Market." });

    // One-time, short-lived bridge to the shared Firebase Auth session on DateVault.
    const code = crypto.randomBytes(32).toString("base64url");
    const codeHash = crypto.createHash("sha256").update(code).digest("hex");
    const now = admin.firestore.Timestamp.now();
    const expiresAt = admin.firestore.Timestamp.fromMillis(now.toMillis() + 2 * 60 * 1000);
    await db.collection("creatorMarketWalletSsoCodes").doc(codeHash).create({
      uid: session.uid,
      audience: "datevault-wallet",
      createdAt: now,
      expiresAt
    });
    const redirectUrl = new URL("https://elysiandate.site/market-wallet-sso.html");
    redirectUrl.searchParams.set("code", code);
    return json(200, { ok: true, redirectUrl: redirectUrl.toString(), expiresInSeconds: 120 });
  } catch (error) {
    console.error("Market wallet SSO issue failed:", error.message);
    return json(500, { error: "Could not securely open your DateVault wallet." });
  }
};
