const crypto = require("crypto");
const { cloudinary } = require("./_cloudinary");
const { json, parseBody, originAllowed } = require("./_market-auth");
const { loadMarketUser, cleanText } = require("./_market-data");

function cloudinaryConfig() {
  cloudinary.config({ secure: true });
  const c = cloudinary.config();
  if (!c.cloud_name || !c.api_key || !c.api_secret) throw new Error("CLOUDINARY_URL is not configured");
  return c;
}

exports.handler = async event => {
  if (!["GET", "POST"].includes(event.httpMethod)) return json(405, { error: "Method not allowed." }, { Allow: "GET, POST" });
  try {
    if (event.httpMethod === "POST" && !originAllowed(event)) return json(403, { error: "Request origin is not allowed." });
    const context = await loadMarketUser(event);
    if (context.error) return context.error;
    if (context.profile.marketAgeVerified === true) return json(200, { verified: true, status: "verified", message: "Your 18+ verification is complete." });
    const db = context.admin.firestore();
    const requestRef = db.collection("marketAgeVerificationRequests").doc(context.uid);

    if (event.httpMethod === "GET") {
      const snap = await requestRef.get();
      if (!snap.exists) return json(200, { verified: false, status: "not_started", message: "Start your age-verification request." });
      const d = snap.data() || {};
      return json(200, { verified: false, status: d.status || "awaiting_upload", requestId: d.requestId || null,
        provider: d.provider || "manual", verificationUrl: d.verificationUrl || null,
        message: d.status === "pending_review" ? (d.provider === "didit" ? "Didit has received your verification and it is awaiting a decision." : "Your evidence was submitted and is awaiting administrator review.") :
          d.status === "didit_in_progress" ? "Your Didit verification is in progress. Continue in the secure verification window." :
          d.status === "rejected" ? (d.reviewNote || "Your request was not approved. You may try again or use manual review.") :
          d.status === "abandoned" ? "Your verification was not completed. You can start again." :
          "Choose Didit verification or submit your ID and selfie for manual review." });
    }

    const body = parseBody(event);
    const action = cleanText(body.action, 32) || "start";
    if (action === "didit-session") {
      const apiKey = process.env.DIDIT_API_KEY;
      const workflowId = process.env.DIDIT_WORKFLOW_ID;
      const environment = String(process.env.DIDIT_ENVIRONMENT || "").toLowerCase();
      const workflowType = String(process.env.DIDIT_WORKFLOW_TYPE || "").toLowerCase();
      const minimumAge = String(process.env.DIDIT_MINIMUM_AGE || "");
      if (!apiKey || !workflowId || !["live", "sandbox"].includes(environment) || workflowType !== "adaptive_age_verification" || minimumAge !== "18") {
        return json(503, { error: "Didit is not configured yet. Please use free manual age review or contact support." });
      }
      const old = await requestRef.get();
      const oldData = old.exists ? (old.data() || {}) : {};
      if (oldData.provider === "didit" && oldData.status === "didit_in_progress" &&
          oldData.verificationUrl && oldData.diditSessionId) {
        return json(200, { requestId: oldData.requestId, status: oldData.status,
          verificationUrl: oldData.verificationUrl, reused: true, chargedTokens: 0 });
      }
      if (oldData.provider === "didit" && oldData.status === "didit_starting") {
        return json(409, { error: "Your automatic verification is already being started. Refresh this page in a moment." });
      }
      if (oldData.status === "pending_review" ||
          (oldData.status === "awaiting_upload" && Object.keys(oldData.evidence || {}).length)) {
        return json(409, { error: "You already have a free manual review request in progress. Finish it or wait for the review before switching methods." });
      }

      // Each new automatic attempt costs 50 tokens. The debit and charge record
      // are committed together, so browser retries and duplicate requests cannot double-charge.
      const requestId = crypto.randomUUID();
      const userRef = db.collection("users").doc(context.uid);
      const chargeRef = db.collection("marketAgeVerificationCharges").doc(requestId);
      const walletTxRef = userRef.collection("walletTransactions").doc();
      const FieldValue = context.admin.firestore.FieldValue;
      try {
        await db.runTransaction(async tx => {
          const [freshUser, priorCharge, freshRequest] = await Promise.all([tx.get(userRef), tx.get(chargeRef), tx.get(requestRef)]);
          if (!freshUser.exists) throw new Error("ACCOUNT_UNAVAILABLE");
          if (priorCharge.exists) throw new Error("CHARGE_ALREADY_EXISTS");
          if (freshRequest.exists) {
            const current = freshRequest.data() || {};
            if (current.provider === "didit" && ["didit_starting", "didit_in_progress"].includes(current.status)) throw new Error("DIDIT_ALREADY_STARTED");
            if (current.status === "pending_review" || (current.status === "awaiting_upload" && Object.keys(current.evidence || {}).length)) throw new Error("MANUAL_REVIEW_ACTIVE");
          }
          const profile = freshUser.data() || {};
          if (profile.banned || profile.suspended || profile.accountSuspended || profile.walletFrozen) throw new Error("WALLET_HOLD");
          const balance = Math.floor(Number(profile.walletBalance || 0));
          if (balance < 50) throw new Error("INSUFFICIENT_TOKENS");
          tx.update(userRef, { walletBalance: balance - 50 });
          tx.create(chargeRef, {
            uid: context.uid, requestId, amountTokens: 50, status: "charged",
            provider: "didit", createdAt: FieldValue.serverTimestamp()
          });
          tx.create(walletTxRef, {
            type: "market_age_verification", amount: -50, note: "Automatic 18+ verification (Didit)",
            status: "completed", referenceId: requestId, createdAt: FieldValue.serverTimestamp()
          });
          tx.set(requestRef, {
            uid: context.uid, requestId, provider: "didit", status: "didit_starting",
            diditChargeId: requestId, diditChargeTokens: 50, evidence: {},
            createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp()
          });
        });
      } catch (error) {
        if (error.message === "INSUFFICIENT_TOKENS") return json(402, { error: "Automatic Didit verification costs 50 tokens. Add tokens or choose free manual verification." });
        if (error.message === "DIDIT_ALREADY_STARTED") return json(409, { error: "Your automatic verification is already being started. Refresh this page in a moment." });
        if (error.message === "MANUAL_REVIEW_ACTIVE") return json(409, { error: "You already have a free manual review request in progress. Finish it or wait for the review before switching methods." });
        if (error.message === "DIDIT_ALREADY_STARTED") return json(409, { error: "Your automatic verification is already being started. Refresh this page in a moment." });
        if (error.message === "MANUAL_REVIEW_ACTIVE") return json(409, { error: "You already have a free manual review request in progress. Finish it or wait for the review before switching methods." });
        if (error.message === "WALLET_HOLD") return json(403, { error: "Your wallet is currently on hold." });
        throw error;
      }

      const refundFailedAttempt = async reason => {
        await db.runTransaction(async tx => {
          const [chargeSnap, userSnap] = await Promise.all([tx.get(chargeRef), tx.get(userRef)]);
          if (!chargeSnap.exists || chargeSnap.data().status !== "charged" || !userSnap.exists) return;
          tx.update(userRef, { walletBalance: Math.floor(Number(userSnap.data().walletBalance || 0)) + 50 });
          tx.update(chargeRef, { status: "refunded", refundReason: reason, refundedAt: FieldValue.serverTimestamp() });
          tx.set(userRef.collection("walletTransactions").doc(), {
            type: "market_age_verification_refund", amount: 50,
            note: "Refund: Didit automatic verification could not be started",
            status: "completed", referenceId: requestId, createdAt: FieldValue.serverTimestamp()
          });
          tx.set(requestRef, { status: "abandoned", diditStartFailure: reason,
            updatedAt: FieldValue.serverTimestamp() }, { merge: true });
        });
      };

      let response, result;
      try {
        response = await fetch("https://verification.didit.me/v3/session/", {
          method: "POST",
          headers: { "x-api-key": apiKey, "Content-Type": "application/json" },
          body: JSON.stringify({
            workflow_id: workflowId, vendor_data: context.uid,
            metadata: { market_request_id: requestId, source: "creator_market_age_verification" },
            language: "en"
          }),
          signal: AbortSignal.timeout(15000)
        });
        result = await response.json().catch(() => ({}));
      } catch (error) {
        await refundFailedAttempt("provider_network_error");
        return json(502, { error: "Didit could not be reached. Your 50 tokens have been refunded; please retry or use free manual review." });
      }
      if (!response.ok) {
        console.error("Didit session creation failed:", response.status, result.detail || result.message || result.error || "provider error");
        await refundFailedAttempt("provider_rejected_request");
        return json(502, { error: "Didit could not start verification. Your 50 tokens have been refunded; please retry or use free manual review." });
      }
      let verificationUrl;
      try {
        verificationUrl = new URL(result.url);
        if (verificationUrl.protocol !== "https:" || verificationUrl.hostname !== "verify.didit.me" || !result.session_id) throw new Error("invalid response");
      } catch (_) {
        await refundFailedAttempt("invalid_provider_response");
        return json(502, { error: "Didit returned an invalid verification link. Your 50 tokens have been refunded; please contact support if this repeats." });
      }
      const sessionId = String(result.session_id);
      try {
        await db.collection("marketDiditSessions").doc(sessionId).set({
          uid: context.uid, requestId, workflowId, environment,
          createdAt: FieldValue.serverTimestamp(), lastAppliedCreatedAt: 0
        });
        await requestRef.set({
          uid: context.uid, requestId, provider: "didit", status: "didit_in_progress",
          diditSessionId: sessionId, verificationUrl: verificationUrl.toString(), evidence: {},
          diditChargeId: requestId, diditChargeTokens: 50,
          updatedAt: FieldValue.serverTimestamp()
        }, { merge: true });
      } catch (error) {
        await db.collection("marketDiditSessions").doc(sessionId).delete().catch(() => null);
        await refundFailedAttempt("session_persistence_failed");
        throw error;
      }
      return json(200, { requestId, status: "didit_in_progress", verificationUrl: verificationUrl.toString(), chargedTokens: 50 });
    }

    if (action === "start") {
      let response;
      await db.runTransaction(async tx => {
        const old = await tx.get(requestRef);
        if (old.exists && ["awaiting_upload", "pending_review"].includes(old.data().status)) {
          if (old.data().provider === "didit") throw new Error("DIDIT_ALREADY_IN_PROGRESS");
          response = { requestId: old.data().requestId, status: old.data().status, verificationUrl: "/verify-age", reused: true };
          return;
        }
        if (old.exists && old.data().status === "didit_starting") throw new Error("DIDIT_ALREADY_IN_PROGRESS");
        const requestId = crypto.randomUUID();
        tx.set(requestRef, { uid: context.uid, requestId, status: "awaiting_upload", provider: "manual", evidence: {},
          createdAt: context.admin.firestore.FieldValue.serverTimestamp(),
          updatedAt: context.admin.firestore.FieldValue.serverTimestamp(),
          evidenceExpiresAt: context.admin.firestore.Timestamp.fromMillis(Date.now() + 7 * 24 * 60 * 60 * 1000) });
        response = { requestId, status: "awaiting_upload", verificationUrl: "/verify-age" };
      });
      return json(200, response);
    }

    if (action === "upload-intent") {
      const slot = cleanText(body.slot, 24), contentType = cleanText(body.contentType, 40).toLowerCase();
      const sizeBytes = Math.floor(Number(body.sizeBytes));
      if (!["identity_document", "selfie"].includes(slot) ||
          !["image/jpeg", "image/png", "image/webp"].includes(contentType) ||
          !Number.isSafeInteger(sizeBytes) || sizeBytes < 1 || sizeBytes > 8 * 1024 * 1024) {
        return json(400, { error: "Upload a JPG, PNG or WebP image no larger than 8 MB." });
      }
      const request = await requestRef.get();
      if (!request.exists || request.data().status !== "awaiting_upload") return json(409, { error: "Start or resume your verification request first." });
      const c = cloudinaryConfig(), uploadId = crypto.randomUUID();
      const publicId = "creator-market-verification/" + context.uid + "/" + request.data().requestId + "/" + slot + "-" + uploadId;
      const timestamp = Math.floor(Date.now() / 1000);
      const signedParams = { public_id: publicId, timestamp, type: "authenticated", overwrite: false };
      const signature = cloudinary.utils.api_sign_request(signedParams, c.api_secret);
      await db.collection("marketAgeVerificationUploads").doc(uploadId).create({
        uid: context.uid, requestId: request.data().requestId, slot, publicId, contentType, sizeBytes,
        expiresAt: context.admin.firestore.Timestamp.fromMillis(Date.now() + 10 * 60 * 1000),
        createdAt: context.admin.firestore.FieldValue.serverTimestamp()
      });
      return json(200, { uploadId, uploadUrl: "https://api.cloudinary.com/v1_1/" + encodeURIComponent(c.cloud_name) + "/image/upload",
        uploadParams: { ...signedParams, api_key: c.api_key, signature }, expiresInSeconds: 600 });
    }

    if (action === "complete-upload") {
      const uploadId = cleanText(body.uploadId, 64);
      if (!uploadId) return json(400, { error: "Upload reference is required." });
      const uploadRef = db.collection("marketAgeVerificationUploads").doc(uploadId);
      const uploadSnap = await uploadRef.get();
      if (!uploadSnap.exists) return json(404, { error: "Upload request not found." });
      const upload = uploadSnap.data();
      if (upload.uid !== context.uid || !upload.expiresAt?.toDate || upload.expiresAt.toDate().getTime() < Date.now()) return json(403, { error: "This upload request is invalid or expired." });
      cloudinaryConfig();
      const asset = await cloudinary.api.resource(upload.publicId, { resource_type: "image", type: "authenticated" });
      if (asset.public_id !== upload.publicId || asset.type !== "authenticated" ||
          !["jpg", "jpeg", "png", "webp"].includes(String(asset.format).toLowerCase()) ||
          !Number.isSafeInteger(Number(asset.bytes)) || Number(asset.bytes) > 8 * 1024 * 1024) {
        return json(400, { error: "The uploaded file did not pass the private evidence checks." });
      }
      await db.runTransaction(async tx => {
        const fresh = await tx.get(requestRef);
        if (!fresh.exists || fresh.data().requestId !== upload.requestId || fresh.data().status !== "awaiting_upload") throw new Error("REQUEST_NOT_ACTIVE");
        tx.set(requestRef, { evidence: { ...(fresh.data().evidence || {}), [upload.slot]: { publicId: upload.publicId, format: asset.format, bytes: asset.bytes } },
          updatedAt: context.admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
        tx.delete(uploadRef);
      });
      const updated = await requestRef.get(), evidence = updated.data().evidence || {};
      const complete = Boolean(evidence.identity_document && evidence.selfie);
      if (complete) await requestRef.update({ status: "pending_review", submittedAt: context.admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: context.admin.firestore.FieldValue.serverTimestamp() });
      return json(200, { ok: true, complete, status: complete ? "pending_review" : "awaiting_upload",
        message: complete ? "Both files were received securely. Your request is awaiting administrator review." : "File received securely. Upload the remaining file." });
    }
    return json(400, { error: "Unsupported verification action." });
  } catch (error) {
    if (error.message === "CLOUDINARY_URL is not configured") return json(503, { error: "Secure evidence storage is not configured yet." });
    if (error.message === "REQUEST_NOT_ACTIVE") return json(409, { error: "This verification request is no longer active." });
    console.error("Market age verification failed:", error.message);
    return json(500, { error: "Unable to process age verification. Please try again." });
  }
};
