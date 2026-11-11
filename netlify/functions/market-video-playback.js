const { json } = require("./_market-auth");
const { loadEligibleUser, cleanText } = require("./_market-data");
const { issueVideoTicket, base64url } = require("./_market-video-ticket");

function basicAuth(apiKey) {
  return "Basic " + Buffer.from(apiKey + ":", "utf8").toString("base64");
}
async function apiVideoGet(path, apiKey) {
  const response = await fetch("https://ws.api.video" + path, {
    headers: { Authorization: basicAuth(apiKey), Accept: "application/json" },
    signal: AbortSignal.timeout(12000)
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error("APIVIDEO_" + response.status);
    error.status = response.status;
    throw error;
  }
  return data;
}
function expiryMillis(entitlement, isOwner) {
  if (isOwner) return Date.now() + 23 * 60 * 60 * 1000;
  if (!entitlement) return 0;
  if (!entitlement.expiresAt) return Date.now() + 23 * 60 * 60 * 1000;
  return entitlement.expiresAt.toDate ? entitlement.expiresAt.toDate().getTime() : new Date(entitlement.expiresAt).getTime();
}
exports.handler = async event => {
  if (event.httpMethod !== "GET") return json(405, { error: "Method not allowed." }, { Allow: "GET" });
  try {
    const context = await loadEligibleUser(event);
    if (context.error) return context.error;
    const listingId = cleanText(event.queryStringParameters?.listingId || "", 128);
    const previewOnly = event.queryStringParameters?.preview === "1";
    if (!listingId) return json(400, { error: "Listing ID is required." });
    const apiKey = process.env.API_VIDEO_API_KEY;
    const gatewayUrl = String(process.env.MARKET_VIDEO_GATEWAY_URL || "").replace(/\/$/, "");
    if (!apiKey || !gatewayUrl) return json(503, { error: "Secure video playback is not configured yet." });
    const db = context.admin.firestore();
    const listingSnap = await db.collection("marketListings").doc(listingId).get();
    if (!listingSnap.exists || listingSnap.data().status !== "published") return json(404, { error: "This content is unavailable." });
    const listing = listingSnap.data();
    if (listing.mediaProvider !== "api_video" || !listing.videoId) return json(409, { error: "This listing is not yet using secure api.video playback." });
    const creatorSnap = await db.collection("marketCreators").doc(listing.creatorUid).get();
    if (!creatorSnap.exists || creatorSnap.data().status !== "approved") return json(404, { error: "This content is unavailable." });
    const isOwner = listing.creatorUid === context.uid;
    let entitlement = null;
    if (!previewOnly && !isOwner) {
      const snap = await db.collection("marketEntitlements").where("buyerUid", "==", context.uid)
        .where("listingId", "==", listingId).where("status", "==", "active").limit(10).get();
      const now = Date.now();
      entitlement = snap.docs.map(doc => doc.data()).find(item => {
        const exp = item.expiresAt?.toDate ? item.expiresAt.toDate().getTime() : item.expiresAt ? new Date(item.expiresAt).getTime() : null;
        return !exp || exp > now;
      });
      if (!entitlement) return json(403, { error: "Purchase an access offer to watch this video." });
    }
    const videoId = String(listing.videoId);
    if (!/^[A-Za-z0-9_-]{6,80}$/.test(videoId)) return json(409, { error: "The stored video reference is invalid." });
    const video = await apiVideoGet("/videos/" + encodeURIComponent(videoId), apiKey);
    if (video.public !== false) return json(409, { error: "This video is not private at the provider. Ask the creator to re-upload it." });
    const hls = String(video.assets?.hls || "");
    const match = hls.match(/\/vod\/[^/]+\/token\/([^/]+)\/hls\/manifest\.m3u8/);
    if (!match) return json(502, { error: "The video provider did not return a private playback token." });
    const privateToken = match[1];
    const sessionData = await apiVideoGet("/vod/" + encodeURIComponent(videoId) + "/token/" + encodeURIComponent(privateToken) + "/session", apiKey);
    const sessionToken = String(sessionData.session_token || "");
    if (!sessionToken) return json(502, { error: "The video provider did not create a playback session." });

    const now = Date.now();
    const expiresAt = previewOnly ? now + 5 * 60 * 1000 : expiryMillis(entitlement, isOwner);
    if (expiresAt <= now) return json(410, { error: "This rental has expired." });
    const claims = {
      aud: new URL(gatewayUrl).host, sub: context.uid, listingId, videoId,
      privateToken, sessionToken, scope: previewOnly ? "preview" : "playback",
      iat: Math.floor(now / 1000), exp: Math.floor(expiresAt / 1000)
    };
    const ticket = issueVideoTicket(claims);
    const providerPath = previewOnly
      ? "/vod/" + videoId + "/token/" + privateToken + "/thumbnail.jpg?avh=" + encodeURIComponent(sessionToken)
      : "/vod/" + videoId + "/token/" + privateToken + "/hls/manifest.m3u8?avh=" + encodeURIComponent(sessionToken);
    const url = gatewayUrl + "/video-gateway?ticket=" + encodeURIComponent(ticket) + "&path=" + encodeURIComponent(base64url(providerPath));
    return json(200, {
      ok: true, playbackUrl: url, previewOnly,
      expiresAt: new Date(expiresAt).toISOString(),
      expiresInSeconds: Math.max(0, Math.floor((expiresAt - now) / 1000)),
      contentType: previewOnly ? "image/jpeg" : "application/vnd.apple.mpegurl",
      title: listing.title, description: listing.description,
      downloadAllowed: !previewOnly && !isOwner && listing.downloadAllowed === true && entitlement?.downloadAllowed === true
    });
  } catch (error) {
    if (error.message?.startsWith("APIVIDEO_")) {
      console.error("api.video request failed:", error.message);
      return json(502, { error: "The video provider could not authorize this video. Please retry shortly." });
    }
    if (error.message?.includes("MARKET_VIDEO_GATEWAY_SECRET")) return json(503, { error: "Secure video gateway signing is not configured." });
    console.error("Market video playback authorization failed:", error.message);
    return json(500, { error: "Unable to authorize video playback." });
  }
};
