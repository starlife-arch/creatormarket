const { json, parseBody } = require("./_market-auth");
const { loadEligibleUser, cleanText } = require("./_market-data");

function auth(apiKey) { return "Basic " + Buffer.from(apiKey + ":", "utf8").toString("base64"); }
exports.handler = async event => {
  if (event.httpMethod !== "POST") return json(405, { error: "Method not allowed." }, { Allow: "POST" });
  try {
    const context = await loadEligibleUser(event);
    if (context.error) return context.error;
    if (context.profile.marketCreatorIdentityVerified !== true) return json(403, { error: "Verified creator identity is required." });
    const body = parseBody(event), listingId = cleanText(body.listingId, 128), uploadId = cleanText(body.uploadId, 80);
    if (!listingId || !uploadId) return json(400, { error: "Listing and upload identifiers are required." });
    const db = context.admin.firestore(), intentRef = db.collection("marketVideoUploadIntents").doc(uploadId);
    const listingRef = db.collection("marketListings").doc(listingId);
    const [intentSnap, listingSnap] = await Promise.all([intentRef.get(), listingRef.get()]);
    if (!intentSnap.exists || !listingSnap.exists || listingSnap.data().creatorUid !== context.uid || listingSnap.data().videoUploadId !== uploadId || listingSnap.data().videoId !== intentSnap.data().videoId) return json(404, { error: "Video upload or creator listing was not found." });
    const intent = intentSnap.data();
    const expiresAt = intent.expiresAt?.toDate ? intent.expiresAt.toDate().getTime() : 0;
    if (intent.uid !== context.uid || intent.listingId !== listingId || expiresAt <= Date.now()) return json(403, { error: "This video upload authorization has expired." });
    if (intent.status === "complete" && listingSnap.data().status === "published") return json(200, { ok: true, status: "published", message: "Your video is already published." });
    const apiKey = process.env.API_VIDEO_API_KEY;
    if (!apiKey) return json(503, { error: "api.video is not configured." });
    const headers = { Authorization: auth(apiKey), Accept: "application/json" };
    const getResponse = await fetch("https://ws.api.video/videos/" + encodeURIComponent(intent.videoId), { headers, signal: AbortSignal.timeout(12000) });
    let video = await getResponse.json().catch(() => ({}));
    if (!getResponse.ok) return json(502, { error: "api.video could not confirm the uploaded video yet. Please retry." });
    if (video.public !== false) {
      const patch = await fetch("https://ws.api.video/videos/" + encodeURIComponent(intent.videoId), {
        method: "PATCH", headers: { ...headers, "Content-Type": "application/json" },
        body: JSON.stringify({ public: false }), signal: AbortSignal.timeout(12000)
      });
      if (!patch.ok) return json(502, { error: "The uploaded video could not be locked as private. It will not be published." });
      const verify = await fetch("https://ws.api.video/videos/" + encodeURIComponent(intent.videoId), { headers, signal: AbortSignal.timeout(12000) });
      video = await verify.json().catch(() => ({}));
      if (!verify.ok || video.public !== false) return json(502, { error: "Private video status could not be confirmed. The listing remains unpublished." });
    }
    if (!video.assets?.hls || !video.assets?.thumbnail || (listingSnap.data().downloadAllowed === true && !video.assets?.mp4)) {
      return json(202, { ok: true, status: "processing", message: "Your video is uploaded privately and is being processed. Check again in a moment." });
    }
    await db.runTransaction(async tx => {
      const [freshIntent, freshListing] = await Promise.all([tx.get(intentRef), tx.get(listingRef)]);
      if (!freshIntent.exists || freshIntent.data().uid !== context.uid || freshIntent.data().status === "expired" ||
          !freshListing.exists || freshListing.data().creatorUid !== context.uid || freshListing.data().videoUploadId !== uploadId || freshListing.data().videoId !== intent.videoId ||
          (freshListing.data().status !== "draft" && freshListing.data().status !== "processing")) {
        throw new Error("VIDEO_UPLOAD_NOT_ACTIVE");
      }
      tx.update(intentRef, { status: "complete", completedAt: context.admin.firestore.FieldValue.serverTimestamp() });
      tx.update(listingRef, {
        mediaProvider: "api_video", videoId: intent.videoId, mediaKind: "video",
        durationSeconds: Math.max(0, Number(video.duration || 0)),
        mediaContentType: intent.contentType, mediaPublicId: null, mediaObjectPath: null,
        status: "published", updatedAt: context.admin.firestore.FieldValue.serverTimestamp()
      });
    });
    return json(200, { ok: true, status: "published", durationSeconds: Math.max(0, Number(video.duration || 0)), message: "Your private api.video upload is ready and the listing is now published." });
  } catch (error) {
    if (error.message === "VIDEO_UPLOAD_NOT_ACTIVE") return json(409, { error: "This video upload or listing is no longer active." });
    console.error("Market api.video upload completion failed:", error.message);
    return json(500, { error: "Unable to verify and publish this private video." });
  }
};
