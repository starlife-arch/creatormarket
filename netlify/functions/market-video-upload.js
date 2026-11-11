const crypto = require("crypto");
const { json, parseBody } = require("./_market-auth");
const { loadEligibleUser, cleanText } = require("./_market-data");
const { issueVideoTicket } = require("./_market-video-ticket");

function auth(apiKey) { return "Basic " + Buffer.from(apiKey + ":", "utf8").toString("base64"); }
exports.handler = async event => {
  if (event.httpMethod !== "POST") return json(405, { error: "Method not allowed." }, { Allow: "POST" });
  try {
    const context = await loadEligibleUser(event);
    if (context.error) return context.error;
    if (context.profile.marketCreatorIdentityVerified !== true) return json(403, { error: "Verified creator identity is required to upload video." });
    const body = parseBody(event);
    const listingId = cleanText(body.listingId, 128);
    const contentType = cleanText(body.contentType, 80).toLowerCase();
    const sizeBytes = Math.floor(Number(body.sizeBytes));
    if (!listingId || !["video/mp4", "video/webm"].includes(contentType) ||
        !Number.isSafeInteger(sizeBytes) || sizeBytes < 1 || sizeBytes > 500 * 1024 * 1024) {
      return json(400, { error: "Upload an MP4 or WebM video no larger than 500 MB." });
    }
    const apiKey = process.env.API_VIDEO_API_KEY;
    const gatewayUrl = String(process.env.MARKET_VIDEO_GATEWAY_URL || "").replace(/\/$/, "");
    if (!apiKey || !gatewayUrl) return json(503, { error: "api.video private upload is not configured yet." });
    const db = context.admin.firestore();
    const listingRef = db.collection("marketListings").doc(listingId);
    const listingSnap = await listingRef.get();
    if (!listingSnap.exists || listingSnap.data().creatorUid !== context.uid || listingSnap.data().status !== "draft") return json(404, { error: "Creator draft listing not found." });
    const listing = listingSnap.data();
    const response = await fetch("https://ws.api.video/videos", {
      method: "POST",
      headers: { Authorization: auth(apiKey), "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({
        title: listing.title, description: listing.description,
        public: false, mp4Support: false
      }),
      signal: AbortSignal.timeout(15000)
    });
    const video = await response.json().catch(() => ({}));
    if (!response.ok || !video.videoId || video.public !== false) {
      console.error("api.video private video creation failed:", response.status, video.message || video.error || "invalid response");
      return json(502, { error: "api.video could not create a private video container. The listing has not been published." });
    }
    const uploadId = crypto.randomUUID(), now = Date.now(), expiresAt = now + 60 * 60 * 1000;
    const gatewayHost = new URL(gatewayUrl).host;
    const ticket = issueVideoTicket({
      aud: gatewayHost, sub: context.uid, listingId, videoId: video.videoId,
      scope: "upload", iat: Math.floor(now / 1000), expMs: expiresAt
    });
    await db.collection("marketVideoUploadIntents").doc(uploadId).create({
      uid: context.uid, listingId, videoId: video.videoId, contentType, sizeBytes,
      status: "uploading", expiresAt: context.admin.firestore.Timestamp.fromMillis(expiresAt),
      createdAt: context.admin.firestore.FieldValue.serverTimestamp()
    });
    await listingRef.update({
      mediaProvider: "api_video", videoId: video.videoId, mediaKind: "video",
      videoUploadId: uploadId, status: "draft",
      updatedAt: context.admin.firestore.FieldValue.serverTimestamp()
    });
    return json(200, {
      ok: true, uploadId, videoId: video.videoId,
      uploadUrl: gatewayUrl + "/video-upload?ticket=" + encodeURIComponent(ticket),
      chunkSizeBytes: 50 * 1024 * 1024, maxSizeBytes: 500 * 1024 * 1024,
      expiresAt: new Date(expiresAt).toISOString(),
      message: "Private video container created. Upload the file in secure 50 MB chunks."
    });
  } catch (error) {
    console.error("Market api.video upload authorization failed:", error.message);
    return json(500, { error: "Unable to prepare a private video upload." });
  }
};
