const encoder = new TextEncoder();

function decodeBase64Url(value) {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(normalized + "=".repeat((4 - normalized.length % 4) % 4));
  return Uint8Array.from(binary, char => char.charCodeAt(0));
}
function encodeBase64Url(value) {
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  bytes.forEach(byte => { binary += String.fromCharCode(byte); });
  return btoa(binary).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}
async function decryptTicket(ticket, secret) {
  const parts = String(ticket || "").split(".");
  if (parts.length !== 3) throw new Error("invalid ticket");
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(secret));
  const key = await crypto.subtle.importKey("raw", digest, "AES-GCM", false, ["decrypt"]);
  const iv = decodeBase64Url(parts[0]), encrypted = decodeBase64Url(parts[1]), tag = decodeBase64Url(parts[2]);
  const combined = new Uint8Array(encrypted.length + tag.length);
  combined.set(encrypted); combined.set(tag, encrypted.length);
  const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, combined);
  return JSON.parse(new TextDecoder().decode(plain));
}
function error(status, message) {
  return new Response(message, { status, headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } });
}
function makeGatewayUrl(requestUrl, ticket, providerUrl) {
  const url = new URL(requestUrl);
  url.pathname = "/video-gateway";
  url.search = "?ticket=" + encodeURIComponent(ticket) + "&path=" + encodeURIComponent(encodeBase64Url(providerUrl.pathname + providerUrl.search));
  return url.toString();
}
function allowedProviderUrl(raw, claims) {
  const url = new URL(raw);
  const prefix = "/vod/" + claims.videoId + "/token/" + claims.privateToken + "/";
  if (url.protocol !== "https:" || url.hostname !== "vod.api.video" || !url.pathname.startsWith(prefix)) throw new Error("provider path rejected");
  url.searchParams.set("avh", claims.sessionToken);
  return url;
}
async function handleUpload(request, env) {
  if (request.method !== "POST") return error(405, "Method not allowed");
  if (!env.MARKET_VIDEO_GATEWAY_SECRET || !env.API_VIDEO_API_KEY) return error(503, "Video upload gateway is not configured");
  const incoming = new URL(request.url);
  let claims;
  try {
    claims = await decryptTicket(incoming.searchParams.get("ticket"), env.MARKET_VIDEO_GATEWAY_SECRET);
    if (claims.aud !== incoming.host || claims.scope !== "upload" || !Number.isFinite(claims.expMs) || claims.expMs <= Date.now()) return error(410, "This upload authorization has expired");
    if (!claims.videoId || !claims.listingId || !claims.sub) return error(403, "Invalid upload authorization");
    if (!/^[A-Za-z0-9_-]{6,80}$/.test(claims.videoId)) return error(403, "Invalid video reference");
  } catch (_) { return error(403, "Invalid upload authorization"); }
  const contentRange = request.headers.get("content-range") || "";
  if (!/^bytes \d+-\d+\/\d+$/.test(contentRange)) return error(400, "A valid byte Content-Range is required");
  const match = contentRange.match(/^bytes (\d+)-(\d+)\/(\d+)$/);
  const start = Number(match[1]), end = Number(match[2]), total = Number(match[3]);
  if (end < start || total < end + 1 || end - start + 1 > 55 * 1024 * 1024) return error(400, "Upload chunks must be no larger than 55 MiB");
  const contentType = request.headers.get("content-type") || "";
  if (!/^multipart\/form-data;\s*boundary=/i.test(contentType)) return error(400, "Upload must use multipart form data");
  const headers = new Headers({
    Authorization: "Basic " + btoa(env.API_VIDEO_API_KEY + ":"),
    "Content-Type": contentType,
    "Content-Range": contentRange,
    Accept: "application/json"
  });
  let upstream;
  try {
    upstream = await fetch("https://ws.api.video/videos/" + encodeURIComponent(claims.videoId) + "/source", {
      method: "POST", headers, body: request.body
    });
  } catch (_) { return error(502, "api.video upload endpoint is temporarily unavailable"); }
  const responseBody = await upstream.text();
  return new Response(responseBody, {
    status: upstream.status,
    headers: {
      "Content-Type": upstream.headers.get("content-type") || "application/json",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff"
    }
  });
}
async function handle(request, env) {
  const incoming = new URL(request.url);
  if (incoming.pathname === "/video-upload") return handleUpload(request, env);
  if (request.method !== "GET" && request.method !== "HEAD") return error(405, "Method not allowed");
  if (!env.MARKET_VIDEO_GATEWAY_SECRET) return error(503, "Video gateway is not configured");
  if (incoming.pathname !== "/video-gateway") return error(404, "Not found");
  let claims, providerUrl;
  try {
    claims = await decryptTicket(incoming.searchParams.get("ticket"), env.MARKET_VIDEO_GATEWAY_SECRET);
    if (claims.aud !== incoming.host || !Number.isFinite(claims.expMs) || claims.expMs <= Date.now()) return error(410, "This rental has expired");
    if (!claims.videoId || !claims.privateToken || !claims.sessionToken || !claims.listingId) return error(403, "Invalid playback authorization");
    const path = new TextDecoder().decode(decodeBase64Url(incoming.searchParams.get("path") || ""));
    providerUrl = allowedProviderUrl("https://vod.api.video" + path, claims);
    if (claims.scope === "preview" && !providerUrl.pathname.endsWith("/thumbnail.jpg")) return error(403, "Preview access only");
  } catch (_) { return error(403, "Invalid or expired playback authorization"); }

  const headers = new Headers();
  for (const name of ["range", "if-range", "if-none-match"]) {
    const value = request.headers.get(name);
    if (value) headers.set(name, value);
  }
  let upstream;
  try {
    upstream = await fetch(providerUrl.toString(), { method: request.method, headers, redirect: "error" });
  } catch (_) { return error(502, "Video provider is temporarily unavailable"); }
  const responseHeaders = new Headers();
  for (const name of ["content-type", "content-length", "content-range", "accept-ranges", "etag", "last-modified"]) {
    const value = upstream.headers.get(name);
    if (value) responseHeaders.set(name, value);
  }
  responseHeaders.set("Cache-Control", "private, no-store");
  responseHeaders.set("Referrer-Policy", "no-referrer");
  responseHeaders.set("X-Content-Type-Options", "nosniff");
  responseHeaders.set("Access-Control-Allow-Origin", "https://market.elysiandate.site");
  responseHeaders.set("Vary", "Origin");

  if (upstream.ok && /mpegurl/i.test(upstream.headers.get("content-type") || "") && request.method !== "HEAD") {
    const manifest = await upstream.text();
    const rewritten = manifest.split(/\r?\n/).map(line => {
      const rewrite = raw => {
        try {
          const resolved = new URL(raw, providerUrl);
          const safe = allowedProviderUrl(resolved.toString(), claims);
          return makeGatewayUrl(request.url, incoming.searchParams.get("ticket"), safe);
        } catch (_) { throw new Error("manifest URI rejected"); }
      };
      if (!line.trim()) return line;
      if (line.trim().startsWith("#")) {
        return line.replace(/URI="([^"]+)"/g, (_match, uri) => 'URI="' + rewrite(uri) + '"');
      }
      return rewrite(line.trim());
    }).join("\n");
    responseHeaders.set("Content-Type", "application/vnd.apple.mpegurl");
    return new Response(rewritten, { status: upstream.status, headers: responseHeaders });
  }
  return new Response(request.method === "HEAD" ? null : upstream.body, { status: upstream.status, headers: responseHeaders });
}
export default { fetch: handle };
