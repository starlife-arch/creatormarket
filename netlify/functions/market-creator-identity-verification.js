const crypto = require("crypto");
const { cloudinary } = require("./_cloudinary");
const { json, parseBody, originAllowed } = require("./_market-auth");
const { loadMarketUser, cleanText } = require("./_market-data");

function cloudinaryConfig() {
  cloudinary.config({ secure: true });
  const c = cloudinary.config();
  if (!c.cloud_name || !c.api_key || !c.api_secret) {
    const error = new Error("CLOUDINARY_URL is not configured");
    error.code = "CLOUDINARY_CONFIG";
    throw error;
  }
  return c;
}

exports.handler = async event => {
  if (!["GET", "POST"].includes(event.httpMethod)) return json(405, { error: "Method not allowed." }, { Allow: "GET, POST" });
  try {
    if (event.httpMethod === "POST" && !originAllowed(event)) return json(403, { error: "Request origin is not allowed." });
    const context = await loadMarketUser(event);
    if (context.error) return context.error;
    const db = context.admin.firestore();
    const requestRef = db.collection("marketCreatorIdentityRequests").doc(context.uid);
    const applicationRef = db.collection("marketCreatorApplications").doc(context.uid);
    const application = await applicationRef.get();
    if (!application.exists || application.data().status === "rejected") {
      return json(403, { error: "Submit a creator application before requesting creator identity verification." });
    }
    if (context.profile.marketCreatorIdentityVerified === true) {
      return json(200, { verified: true, status: "verified", message: "Your creator identity verification is complete." });
    }

    if (event.httpMethod === "GET") {
      const snap = await requestRef.get();
      if (!snap.exists) return json(200, { verified: false, status: "not_started", message: "Submit a separate creator identity check." });
      const d = snap.data() || {};
      return json(200, {
        verified: false, status: d.status || "awaiting_upload",
        message: d.status === "pending_review" ? "Your creator identity evidence is awaiting admin review." :
          d.status === "rejected" ? (d.reviewNote || "Your creator identity check was not approved. You may submit new evidence.") :
          d.status === "expired" ? "Your previous evidence expired. Start a new request." :
          "Upload a government identity document and a recent selfie for creator identity review."
      });
    }

    const body = parseBody(event);
    const action = cleanText(body.action, 32) || "start";
    if (action === "start") {
      const old = await requestRef.get();
      if (old.exists && ["awaiting_upload", "pending_review"].includes(old.data().status)) {
        return json(200, { requestId: old.data().requestId, status: old.data().status, reused: true });
      }
      const requestId = crypto.randomUUID();
      await requestRef.set({
        uid: context.uid, requestId, status: "awaiting_upload", evidence: {},
        createdAt: context.admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: context.admin.firestore.FieldValue.serverTimestamp(),
        evidenceExpiresAt: context.admin.firestore.Timestamp.fromMillis(Date.now() + 7 * 24 * 60 * 60 * 1000)
      });
      return json(200, { requestId, status: "awaiting_upload" });
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
      if (!request.exists || request.data().status !== "awaiting_upload") {
        return json(409, { error: "Start or resume your creator identity request first." });
      }
      const c = cloudinaryConfig(), uploadId = crypto.randomUUID();
      const publicId = "creator-market-identity/" + context.uid + "/" + request.data().requestId + "/" + slot + "-" + uploadId;
      const timestamp = Math.floor(Date.now() / 1000);
      const signedParams = { public_id: publicId, timestamp, type: "authenticated", overwrite: false };
      const signature = cloudinary.utils.api_sign_request(signedParams, c.api_secret);
      await db.collection("marketCreatorIdentityUploads").doc(uploadId).create({
        uid: context.uid, requestId: request.data().requestId, slot, publicId, contentType, sizeBytes,
        expiresAt: context.admin.firestore.Timestamp.fromMillis(Date.now() + 10 * 60 * 1000),
        createdAt: context.admin.firestore.FieldValue.serverTimestamp()
      });
      return json(200, {
        uploadId,
        uploadUrl: "https://api.cloudinary.com/v1_1/" + encodeURIComponent(c.cloud_name) + "/image/upload",
        uploadParams: { ...signedParams, api_key: c.api_key, signature },
        expiresInSeconds: 600
      });
    }

    if (action === "complete-upload") {
      const uploadId = cleanText(body.uploadId, 64);
      if (!uploadId) return json(400, { error: "Upload reference is required." });
      const uploadRef = db.collection("marketCreatorIdentityUploads").doc(uploadId);
      const uploadSnap = await uploadRef.get();
      if (!uploadSnap.exists) return json(404, { error: "Upload request not found." });
      const upload = uploadSnap.data();
      if (upload.uid !== context.uid || !upload.expiresAt?.toDate || upload.expiresAt.toDate().getTime() < Date.now()) {
        return json(403, { error: "This upload request is invalid or expired." });
      }
      cloudinaryConfig();
      const asset = await cloudinary.api.resource(upload.publicId, { resource_type: "image", type: "authenticated" });
      if (asset.public_id !== upload.publicId || asset.type !== "authenticated" ||
          !["jpg", "jpeg", "png", "webp"].includes(String(asset.format).toLowerCase()) ||
          !Number.isSafeInteger(Number(asset.bytes)) || Number(asset.bytes) > 8 * 1024 * 1024) {
        return json(400, { error: "The uploaded file did not pass the private evidence checks." });
      }
      await db.runTransaction(async tx => {
        const fresh = await tx.get(requestRef);
        if (!fresh.exists || fresh.data().requestId !== upload.requestId || fresh.data().status !== "awaiting_upload") {
          throw new Error("IDENTITY_REQUEST_NOT_ACTIVE");
        }
        tx.set(requestRef, {
          evidence: { ...(fresh.data().evidence || {}), [upload.slot]: { publicId: upload.publicId, format: asset.format, bytes: asset.bytes } },
          updatedAt: context.admin.firestore.FieldValue.serverTimestamp()
        }, { merge: true });
        tx.delete(uploadRef);
      });
      const updated = await requestRef.get(), evidence = updated.data().evidence || {};
      const complete = Boolean(evidence.identity_document && evidence.selfie);
      if (complete) await requestRef.update({
        status: "pending_review",
        submittedAt: context.admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: context.admin.firestore.FieldValue.serverTimestamp()
      });
      return json(200, {
        ok: true, complete, status: complete ? "pending_review" : "awaiting_upload",
        message: complete ? "Both files were received privately. Your creator identity request is awaiting admin review." : "File received securely. Upload the remaining file."
      });
    }
    return json(400, { error: "Unsupported creator identity action." });
  } catch (error) {
    if (error.code === "CLOUDINARY_CONFIG") return json(503, { error: "Secure evidence storage is not configured yet." });
    if (error.message === "IDENTITY_REQUEST_NOT_ACTIVE") return json(409, { error: "This identity request is no longer active." });
    console.error("Market creator identity verification failed:", error.message);
    return json(500, { error: "Unable to process creator identity verification." });
  }
};
