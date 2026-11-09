const crypto = require("crypto");
const { getStorage } = require("firebase-admin/storage");
const { json, parseBody } = require("./_market-auth");
const { loadEligibleUser, cleanText } = require("./_market-data");

const TYPES = new Map([
  ["image/jpeg", 30 * 1024 * 1024], ["image/png", 30 * 1024 * 1024],
  ["image/webp", 30 * 1024 * 1024], ["video/mp4", 500 * 1024 * 1024],
  ["video/webm", 500 * 1024 * 1024]
]);

exports.handler = async event => {
  if (event.httpMethod !== "POST") return json(405, { error: "Method not allowed" }, { Allow: "POST" });
  try {
    const context = await loadEligibleUser(event);
    if (context.error) return context.error;
    if (context.profile.marketCreatorIdentityVerified !== true) return json(403, { error: "Verified creator identity is required." });
    const body = parseBody(event);
    const listingId = cleanText(body.listingId, 128);
    const contentType = cleanText(body.contentType, 80).toLowerCase();
    const sizeBytes = Math.floor(Number(body.sizeBytes));
    const maxBytes = TYPES.get(contentType);
    if (!listingId || !maxBytes || !Number.isSafeInteger(sizeBytes) || sizeBytes < 1 || sizeBytes > maxBytes) {
      return json(400, { error: "Unsupported media type or file size. Images may be up to 30 MB and MP4/WebM videos up to 500 MB." });
    }
    const bucketName = process.env.MARKET_STORAGE_BUCKET;
    if (!bucketName) return json(503, { error: "Private Market storage is not configured yet." });
    const db = context.admin.firestore();
    const listingRef = db.collection("marketListings").doc(listingId);
    const listing = await listingRef.get();
    if (!listing.exists || listing.data().creatorUid !== context.uid || listing.data().status !== "draft") return json(404, { error: "Creator draft listing not found." });
    const uploadId = crypto.randomUUID();
    const objectPath = "creator-market/" + context.uid + "/" + listingId + "/" + uploadId;
    const expiresAt = Date.now() + 5 * 60 * 1000;
    const bucket = getStorage(context.admin.app()).bucket(bucketName);
    const [uploadUrl] = await bucket.file(objectPath).getSignedUrl({
      version: "v4", action: "write", expires: expiresAt, contentType,
      extensionHeaders: { "x-goog-if-generation-match": "0" }
    });
    await db.collection("marketUploadIntents").doc(uploadId).create({
      uid: context.uid, listingId, objectPath, contentType, sizeBytes,
      expiresAt: context.admin.firestore.Timestamp.fromMillis(expiresAt),
      createdAt: context.admin.firestore.FieldValue.serverTimestamp()
    });
    return json(200, { ok: true, uploadId, uploadUrl, objectPath, contentType, uploadHeaders: { "Content-Type": contentType, "x-goog-if-generation-match": "0" }, expiresInSeconds: 300 });
  } catch (error) {
    console.error("Market signed upload creation failed:", error.message);
    return json(500, { error: "Unable to prepare a private media upload." });
  }
};
