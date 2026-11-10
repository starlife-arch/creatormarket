const crypto = require("crypto");
const cloudinary = require("cloudinary").v2;
const { json, parseBody } = require("./_market-auth");
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
        message: d.status === "pending_review" ? "Your evidence was submitted and is awaiting administrator review." :
          d.status === "rejected" ? (d.reviewNote || "Your request was not approved. You may submit a new request.") :
          "Upload a photo of your identity document and a selfie to request review." });
    }

    const body = parseBody(event);
    const action = cleanText(body.action, 32) || "start";
    if (action === "start") {
      const old = await requestRef.get();
      if (old.exists && ["awaiting_upload", "pending_review"].includes(old.data().status)) {
        return json(200, { requestId: old.data().requestId, status: old.data().status, verificationUrl: "/verify-age.html", reused: true });
      }
      const requestId = crypto.randomUUID();
      await requestRef.set({ uid: context.uid, requestId, status: "awaiting_upload", evidence: {},
        createdAt: context.admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: context.admin.firestore.FieldValue.serverTimestamp(),
        evidenceExpiresAt: context.admin.firestore.Timestamp.fromMillis(Date.now() + 7 * 24 * 60 * 60 * 1000) });
      return json(200, { requestId, status: "awaiting_upload", verificationUrl: "/verify-age.html" });
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
