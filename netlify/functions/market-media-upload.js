const crypto = require("crypto");
const cloudinary = require("cloudinary").v2;
const { json, parseBody } = require("./_market-auth");
const { loadEligibleUser, cleanText } = require("./_market-data");

const TYPES = new Map([
  ["image/jpeg", { resourceType: "image", maxBytes: 30 * 1024 * 1024 }],
  ["image/png", { resourceType: "image", maxBytes: 30 * 1024 * 1024 }],
  ["image/webp", { resourceType: "image", maxBytes: 30 * 1024 * 1024 }],
  ["video/mp4", { resourceType: "video", maxBytes: 500 * 1024 * 1024 }],
  ["video/webm", { resourceType: "video", maxBytes: 500 * 1024 * 1024 }]
]);

function cloudinaryConfig() {
  cloudinary.config({ secure: true });
  const config = cloudinary.config();
  if (!config.cloud_name || !config.api_key || !config.api_secret) {
    throw new Error("CLOUDINARY_URL is not configured");
  }
  return config;
}

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
    const media = TYPES.get(contentType);
    if (!listingId || !media || !Number.isSafeInteger(sizeBytes) || sizeBytes < 1 || sizeBytes > media.maxBytes) {
      return json(400, { error: "Unsupported media type or file size. Images may be up to 30 MB and MP4/WebM videos up to 500 MB." });
    }

    const uploadPreset = process.env.MARKET_CLOUDINARY_UPLOAD_PRESET;
    if (!uploadPreset) return json(503, { error: "Private Market media upload is not configured yet." });
    const config = cloudinaryConfig();
    const db = context.admin.firestore();
    const listingRef = db.collection("marketListings").doc(listingId);
    const listing = await listingRef.get();
    if (!listing.exists || listing.data().creatorUid !== context.uid || listing.data().status !== "draft") {
      return json(404, { error: "Creator draft listing not found." });
    }

    const uploadId = crypto.randomUUID();
    const publicId = "creator-market/" + context.uid + "/" + listingId + "/" + uploadId;
    const timestamp = Math.floor(Date.now() / 1000);
    const signedParams = {
      public_id: publicId,
      timestamp,
      type: "authenticated",
      upload_preset: uploadPreset
    };
    const signature = cloudinary.utils.api_sign_request(signedParams, config.api_secret);
    const expiresAt = Date.now() + 5 * 60 * 1000;

    await db.collection("marketUploadIntents").doc(uploadId).create({
      uid: context.uid, listingId, publicId, resourceType: media.resourceType,
      contentType, sizeBytes,
      expiresAt: context.admin.firestore.Timestamp.fromMillis(expiresAt),
      createdAt: context.admin.firestore.FieldValue.serverTimestamp()
    });

    return json(200, {
      ok: true,
      uploadId,
      uploadUrl: "https://api.cloudinary.com/v1_1/" + encodeURIComponent(config.cloud_name) + "/" + media.resourceType + "/upload",
      uploadParams: { ...signedParams, api_key: config.api_key, signature },
      expiresInSeconds: 300
    });
  } catch (error) {
    console.error("Market Cloudinary upload authorization failed:", error.message);
    return json(500, { error: "Unable to prepare a private media upload." });
  }
};
