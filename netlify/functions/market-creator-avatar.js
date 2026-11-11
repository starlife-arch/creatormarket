const crypto = require("crypto");
const { cloudinary } = require("./_cloudinary");
const { json, parseBody } = require("./_market-auth");
const { loadEligibleUser, cleanText } = require("./_market-data");

function cloudinaryConfig() {
  cloudinary.config({ secure: true });
  const config = cloudinary.config();
  if (!config.cloud_name || !config.api_key || !config.api_secret) {
    const error = new Error("CLOUDINARY_CONFIG"); error.code = "CLOUDINARY_CONFIG"; throw error;
  }
  return config;
}
exports.handler = async event => {
  if (event.httpMethod !== "POST") return json(405, { error: "Method not allowed" }, { Allow: "POST" });
  try {
    const context = await loadEligibleUser(event);
    if (context.error) return context.error;
    if (context.profile.marketCreatorIdentityVerified !== true) return json(403, { error: "Verified creator identity is required." });
    const db = context.admin.firestore();
    const creatorRef = db.collection("marketCreators").doc(context.uid);
    const creatorSnap = await creatorRef.get();
    if (!creatorSnap.exists || creatorSnap.data().status !== "approved") return json(403, { error: "An approved creator account is required." });
    const body = parseBody(event), action = cleanText(body.action, 20);
    const config = cloudinaryConfig();
    if (action === "prepare") {
      const contentType = cleanText(body.contentType, 80).toLowerCase();
      const sizeBytes = Math.floor(Number(body.sizeBytes));
      if (!["image/jpeg", "image/png", "image/webp"].includes(contentType) || !Number.isSafeInteger(sizeBytes) || sizeBytes < 1 || sizeBytes > 5 * 1024 * 1024) return json(400, { error: "Choose a JPG, PNG or WebP avatar up to 5 MB." });
      const preset = process.env.MARKET_CLOUDINARY_UPLOAD_PRESET;
      if (!preset) return json(503, { error: "Market image uploads are not configured." });
      const uploadId = crypto.randomUUID(), publicId = "creator-market/" + context.uid + "/profile/avatar-" + uploadId;
      const timestamp = Math.floor(Date.now() / 1000);
      const signedParams = { public_id: publicId, timestamp, upload_preset: preset, type: "authenticated", overwrite: false };
      const signature = cloudinary.utils.api_sign_request(signedParams, config.api_secret);
      await db.collection("marketCreatorAvatarIntents").doc(uploadId).create({
        uid: context.uid, publicId, contentType, sizeBytes,
        expiresAt: context.admin.firestore.Timestamp.fromMillis(Date.now() + 5 * 60 * 1000),
        createdAt: context.admin.firestore.FieldValue.serverTimestamp()
      });
      return json(200, { ok: true, uploadId,
        uploadUrl: "https://api.cloudinary.com/v1_1/" + encodeURIComponent(config.cloud_name) + "/image/upload",
        uploadParams: { ...signedParams, api_key: config.api_key, signature } });
    }
    if (action === "complete") {
      const uploadId = cleanText(body.uploadId, 80);
      if (!uploadId) return json(400, { error: "Avatar upload reference is required." });
      const intentRef = db.collection("marketCreatorAvatarIntents").doc(uploadId), intent = await intentRef.get();
      if (!intent.exists) return json(404, { error: "Avatar upload was not found." });
      const data = intent.data(), expiry = data.expiresAt?.toDate ? data.expiresAt.toDate().getTime() : new Date(data.expiresAt).getTime();
      if (data.uid !== context.uid || data.completedAt || !Number.isFinite(expiry) || expiry <= Date.now()) return json(410, { error: "Avatar upload authorization expired or was already used." });
      const resource = await cloudinary.api.resource(data.publicId, { resource_type: "image", type: "authenticated" });
      if (resource.resource_type !== "image" || resource.type !== "authenticated" || Number(resource.bytes) !== Number(data.sizeBytes) || Number(resource.bytes) > 5 * 1024 * 1024 || !["jpg", "jpeg", "png", "webp"].includes(String(resource.format).toLowerCase()) || resource.public_id !== data.publicId) {
        await cloudinary.uploader.destroy(data.publicId, { resource_type: "image", type: "authenticated", invalidate: true }).catch(() => null);
        return json(400, { error: "Uploaded avatar did not match the authorized image." });
      }
      await db.runTransaction(async tx => {
        const [freshIntent, freshCreator] = await Promise.all([tx.get(intentRef), tx.get(creatorRef)]);
        if (!freshIntent.exists || freshIntent.data().completedAt || !freshCreator.exists || freshCreator.data().status !== "approved") throw new Error("AVATAR_UPLOAD_ALREADY_USED");
        tx.update(intentRef, { completedAt: context.admin.firestore.FieldValue.serverTimestamp() });
        tx.update(creatorRef, { avatarPublicId: data.publicId, avatarPreviewUrl: cloudinary.url(data.publicId, { resource_type: "image", type: "authenticated", sign_url: true, secure: true }), updatedAt: context.admin.firestore.FieldValue.serverTimestamp() });
      });
      const oldId = creatorSnap.data().avatarPublicId;
      if (oldId && oldId !== data.publicId) await cloudinary.uploader.destroy(oldId, { resource_type: "image", type: "authenticated", invalidate: true }).catch(() => null);
      return json(200, { ok: true, avatarUrl: cloudinary.url(data.publicId, { resource_type: "image", type: "authenticated", sign_url: true, secure: true }) });
    }
    return json(400, { error: "Unsupported avatar action." });
  } catch (error) {
    if (error.code === "CLOUDINARY_CONFIG") return json(503, { error: "Market image storage is not configured." });
    if (error.http_code === 404) return json(400, { error: "The uploaded avatar was not found. Please upload it again." });
    if (error.message === "AVATAR_UPLOAD_ALREADY_USED") return json(409, { error: "This avatar upload was already completed." });
    console.error("Market creator avatar update failed:", error.message);
    return json(500, { error: "Unable to update creator avatar." });
  }
};
