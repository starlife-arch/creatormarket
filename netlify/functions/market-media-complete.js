const { getStorage } = require("firebase-admin/storage");
const { json, parseBody } = require("./_market-auth");
const { loadEligibleUser, cleanText } = require("./_market-data");

const MAX_BYTES = { "image/jpeg": 30 * 1024 * 1024, "image/png": 30 * 1024 * 1024, "image/webp": 30 * 1024 * 1024, "video/mp4": 500 * 1024 * 1024, "video/webm": 500 * 1024 * 1024 };

exports.handler = async event => {
  if (event.httpMethod !== "POST") return json(405, { error: "Method not allowed" }, { Allow: "POST" });
  try {
    const context = await loadEligibleUser(event);
    if (context.error) return context.error;
    if (context.profile.marketCreatorIdentityVerified !== true) return json(403, { error: "Verified creator identity is required." });
    const body = parseBody(event);
    const listingId = cleanText(body.listingId, 128), uploadId = cleanText(body.uploadId, 80);
    if (!listingId || !uploadId) return json(400, { error: "Listing and upload identifiers are required." });
    const db = context.admin.firestore();
    const intentRef = db.collection("marketUploadIntents").doc(uploadId);
    const listingRef = db.collection("marketListings").doc(listingId);
    const [intent, listing] = await Promise.all([intentRef.get(), listingRef.get()]);
    if (!intent.exists || !listing.exists || listing.data().creatorUid !== context.uid || listing.data().status !== "draft") return json(404, { error: "Upload or creator draft not found." });
    const data = intent.data();
    const expiry = data.expiresAt?.toDate ? data.expiresAt.toDate().getTime() : new Date(data.expiresAt).getTime();
    if (data.uid !== context.uid || data.listingId !== listingId || data.completedAt || !Number.isFinite(expiry) || expiry <= Date.now()) return json(400, { error: "This upload authorization has expired or was already used." });
    const bucketName = process.env.MARKET_STORAGE_BUCKET;
    if (!bucketName) return json(503, { error: "Private Market storage is not configured." });
    const file = getStorage(context.admin.app()).bucket(bucketName).file(data.objectPath);
    const [exists] = await file.exists();
    if (!exists) return json(400, { error: "The media upload was not found. Please retry the upload." });
    const [metadata] = await file.getMetadata();
    const size = Number(metadata.size || 0), contentType = metadata.contentType || "";
    if (size !== Number(data.sizeBytes) || size > (MAX_BYTES[contentType] || 0) || contentType !== data.contentType) {
      await file.delete({ ignoreNotFound: true }).catch(() => null);
      return json(400, { error: "Uploaded media did not match the authorized file type or size." });
    }
    await db.runTransaction(async tx => {
      const [freshIntent, freshListing] = await Promise.all([tx.get(intentRef), tx.get(listingRef)]);
      if (!freshIntent.exists || freshIntent.data().completedAt || freshListing.data()?.status !== "draft" || freshListing.data()?.creatorUid !== context.uid) throw new Error("UPLOAD_ALREADY_USED");
      tx.update(intentRef, { completedAt: context.admin.firestore.FieldValue.serverTimestamp() });
      tx.update(listingRef, {
        mediaObjectPath: data.objectPath, mediaContentType: contentType,
        mediaSizeBytes: size, status: "published",
        updatedAt: context.admin.firestore.FieldValue.serverTimestamp()
      });
    });
    return json(200, { ok: true, status: "published", message: "Your private media is uploaded and the listing is now published." });
  } catch (error) {
    if (error.message === "UPLOAD_ALREADY_USED") return json(409, { error: "This upload has already been completed." });
    console.error("Market media completion failed:", error.message);
    return json(500, { error: "Unable to verify and publish this media." });
  }
};
