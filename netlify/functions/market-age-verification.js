const crypto = require("crypto");
const { json, parseBody } = require("./_market-auth");
const { loadMarketUser } = require("./_market-data");

const YOTI_API = "https://age.yoti.com/api/v1";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function yotiHeaders() {
  const key = process.env.YOTI_AGE_API_KEY;
  const sdkId = process.env.YOTI_SDK_ID;
  if (!key || !sdkId) throw new Error("YOTI_NOT_CONFIGURED");
  return {
    Authorization: "Bearer " + key,
    "Yoti-Sdk-Id": sdkId,
    "Content-Type": "application/json"
  };
}

async function yotiRequest(url, options) {
  const response = await fetch(url, { ...options, headers: { ...yotiHeaders(), ...(options?.headers || {}) } });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error("YOTI_REQUEST_FAILED");
    error.status = response.status;
    throw error;
  }
  return data;
}

exports.handler = async event => {
  if (!["GET", "POST"].includes(event.httpMethod)) {
    return json(405, { error: "Method not allowed." }, { Allow: "GET, POST" });
  }
  try {
    const context = await loadMarketUser(event);
    if (context.error) return context.error;
    if (context.profile.marketAgeVerified === true) {
      return json(200, { verified: true, status: "verified", message: "Your 18+ verification is already complete." });
    }

    const db = context.admin.firestore();
    const userRef = db.collection("users").doc(context.uid);
    const activeRef = db.collection("marketAgeVerificationActive").doc(context.uid);

    if (event.httpMethod === "POST") {
      const existing = await activeRef.get();
      if (existing.exists) {
        const saved = existing.data() || {};
        if (saved.expiresAt?.toDate && saved.expiresAt.toDate().getTime() > Date.now() &&
            saved.status !== "FAIL" && saved.status !== "ERROR" && saved.status !== "CANCELLED") {
          return json(200, {
            verificationUrl: saved.verificationUrl,
            status: saved.status || "PENDING",
            expiresAt: saved.expiresAt.toDate().toISOString(),
            reused: true
          });
        }
      }

      const origin = (process.env.MARKET_ORIGIN || "https://market.elysiandate.site").replace(/\/$/, "");
      const callbackUrl = origin + "/studio.html?ageVerification=complete";
      const referenceId = crypto.createHash("sha256").update(context.uid).digest("hex").slice(0, 32);
      const created = await yotiRequest(YOTI_API + "/sessions", {
        method: "POST",
        body: JSON.stringify({
          type: "OVER",
          ttl: 900,
          reference_id: referenceId,
          callback: { url: callbackUrl, auto: true },
          age_estimation: { allowed: true, threshold: 21, level: "PASSIVE", retry_limit: 2 },
          digital_id: { allowed: true, threshold: 18, age_estimation_allowed: true, age_estimation_threshold: 21, retry_limit: 2 },
          doc_scan: { allowed: true, threshold: 18, level: "PASSIVE", authenticity: "AUTO", retry_limit: 2 }
        })
      });
      if (!created.id || !UUID.test(created.id)) throw new Error("YOTI_INVALID_SESSION");
      const expiresAt = created.expires_at ? new Date(created.expires_at) : new Date(Date.now() + 15 * 60 * 1000);
      const verificationUrl = "https://age.yoti.com?sessionId=" + encodeURIComponent(created.id) +
        "&sdkId=" + encodeURIComponent(process.env.YOTI_SDK_ID);
      await activeRef.set({
        uid: context.uid,
        provider: "yoti",
        sessionId: created.id,
        referenceId,
        verificationUrl,
        status: created.status || "PENDING",
        expiresAt: context.admin.firestore.Timestamp.fromDate(expiresAt),
        createdAt: context.admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: context.admin.firestore.FieldValue.serverTimestamp()
      });
      return json(200, { verificationUrl, status: created.status || "PENDING", expiresAt: expiresAt.toISOString() });
    }

    const active = await activeRef.get();
    const saved = active.exists ? active.data() || {} : {};
    const sessionId = String(event.queryStringParameters?.sessionId || saved.sessionId || "");
    if (!UUID.test(sessionId)) return json(200, { verified: false, status: "not_started", message: "You have not started age verification yet." });
    const snap = await db.collection("marketAgeVerificationSessions").doc(sessionId).get();
    if (!snap.exists && saved.sessionId !== sessionId) return json(404, { error: "Verification session not found." });
    const session = snap.exists ? snap.data() : saved;
    if (session.uid !== context.uid || session.sessionId !== sessionId) {
      return json(403, { error: "This verification session does not belong to your account." });
    }

    const result = await yotiRequest(YOTI_API + "/sessions/" + encodeURIComponent(sessionId) + "/result", { method: "GET" });
    const status = String(result.status || "UNKNOWN").toUpperCase();
    const now = context.admin.firestore.FieldValue.serverTimestamp();

    if (status === "COMPLETE" && result.type === "OVER") {
      await userRef.update({
        marketAgeVerified: true,
        marketAgeVerifiedAt: now,
        marketAgeVerificationProvider: "yoti",
        marketAgeVerificationSessionId: sessionId
      });
      await activeRef.set({ ...session, status: "COMPLETE", completedAt: now, updatedAt: now }, { merge: true });
      await db.collection("marketAdminAudit").doc().set({
        actorUid: "yoti",
        action: "market_age_verification_passed",
        targetUid: context.uid,
        provider: "yoti",
        sessionId,
        createdAt: now
      });
      return json(200, { verified: true, status: "verified", message: "Your 18+ verification is complete." });
    }

    if (["FAIL", "ERROR", "CANCELLED", "EXPIRED"].includes(status)) {
      await activeRef.set({ ...session, status, updatedAt: now }, { merge: true });
      return json(200, {
        verified: false,
        status: status.toLowerCase(),
        message: status === "FAIL" ? "The provider could not confirm that you meet the 18+ requirement. You can start a new check." : "This verification attempt did not finish. You can start a new check."
      });
    }

    await activeRef.set({ ...session, status, updatedAt: now }, { merge: true });
    return json(200, { verified: false, status: status.toLowerCase(), message: "Your verification is still being processed." });
  } catch (error) {
    if (error.message === "YOTI_NOT_CONFIGURED") {
      return json(503, { error: "Age verification is not connected yet. The Market administrator must configure the Yoti API credentials." });
    }
    console.error("Market age verification failed:", error.message);
    return json(502, { error: "We could not contact the age-verification provider. Please try again shortly." });
  }
};
