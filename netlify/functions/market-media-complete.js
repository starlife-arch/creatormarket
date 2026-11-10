const { cloudinary } = require("./_cloudinary");
const { json, parseBody } = require("./_market-auth");
const { loadEligibleUser, cleanText } = require("./_market-data");
const MAX_BYTES = {
  image: { jpg: 30 * 1024 * 1024, jpeg: 30 * 1024 * 1024, png: 30 * 1024 * 1024, webp: 30 * 1024 * 1024 },
  video: { mp4: 500 * 1024 * 1024, webm: 500 * 1024 * 1024 }
};
exports.handler = async event => {
  if (event.httpMethod !== "POST") return json(405, { error: "Method not allowed" }, { Allow: "POST" });
  try {
    const context = await loadEligibleUser(event);
    if (context.error) return context.error;
    if (context.profile.marketCreatorIdentityVerified !== true) return json(403, { error: "Verified creator identity is required." });
    const body = parseBody(event), listingId = cleanText(body.listingId, 128), uploadId = cleanText(body.uploadId, 80);
    if (!listingId || !uploadId) return json(400, { error: "Listing and upload identifiers are required." });
    const db = context.admin.firestore(), intentRef = db.collection("marketUploadIntents").doc(uploadId), listingRef = db.collection("marketListings").doc(listingId);
    const [intent, listing] = await Promise.all([intentRef.get(), listingRef.get()]);
    if (!intent.exists || !listing.exists || listing.data().creatorUid !== context.uid || listing.data().status !== "draft") return json(404, { error: "Upload or creator draft not found." });
    const data = intent.data(), expiry = data.expiresAt?.toDate ? data.expiresAt.toDate().getTime() : new Date(data.expiresAt).getTime();
    if (data.uid !== context.uid || data.listingId !== listingId || data.completedAt || !Number.isFinite(expiry) || expiry <= Date.now()) return json(400, { error: "This upload authorization has expired or was already used." });
    cloudinary.config({ secure: true });
    const resource = await cloudinary.api.resource(data.publicId, { resource_type: data.resourceType, type: "authenticated" });
    const bytes = Number(resource.bytes || 0), format = String(resource.format || "").toLowerCase(), contentType = data.contentType;
    const allowed = data.resourceType === "image" ? ["image/jpeg", "image/png", "image/webp"].includes(contentType) : ["video/mp4", "video/webm"].includes(contentType);
    if (!allowed || bytes !== Number(data.sizeBytes) || bytes < 1 || bytes > (MAX_BYTES[data.resourceType]?.[format] || 0) ||
        resource.resource_type !== data.resourceType || resource.type !== "authenticated" ||
        !String(resource.public_id || "").startsWith("creator-market/" + context.uid + "/" + listingId + "/")) {
      await cloudinary.uploader.destroy(data.publicId, { resource_type: data.resourceType, type: "authenticated", invalidate: true }).catch(() => null);
      return json(400, { error: "Uploaded media did not match the authorized file type, size or private storage location." });
    }
    await db.runTransaction(async tx => {
      const [freshIntent, freshListing] = await Promise.all([tx.get(intentRef), tx.get(listingRef)]);
      if (!freshIntent.exists || freshIntent.data().completedAt || freshListing.data()?.status !== "draft" || freshListing.data()?.creatorUid !== context.uid) throw new Error("UPLOAD_ALREADY_USED");
      tx.update(intentRef, { completedAt: context.admin.firestore.FieldValue.serverTimestamp() });
      tx.update(listingRef, {
        mediaPublicId: data.publicId, mediaResourceType: data.resourceType, mediaFormat: format,
        mediaContentType: contentType, mediaSizeBytes: bytes, mediaObjectPath: null, status: "published",
        updatedAt: context.admin.firestore.FieldValue.serverTimestamp()
      });
    });
    return json(200, { ok: true, status: "published", message: "Your private media is uploaded and the listing is now published." });
  } catch (error) {
    if (error.message === "UPLOAD_ALREADY_USED") return json(409, { error: "This upload has already been completed." });
    if (error.http_code === 404) return json(400, { error: "The Cloudinary upload was not found. Please retry the upload." });
    if (error.code === "CLOUDINARY_CONFIG") return json(503, { error: "Secure Cloudinary media storage is not configured." });
    console.error("Market Cloudinary media completion failed:", error.message);
    return json(500, { error: "Unable to verify and publish this media." });
  }
};
