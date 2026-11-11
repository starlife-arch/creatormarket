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
async function handle(request, env) {
  if (request.method !== "GET" && request.method !== "HEAD") return error(405, "Method not allowed");
  if (!env.MARKET_VIDEO_GATEWAY_SECRET) return error(503, "Video gateway is not configured");
  const incoming = new URL(request.url);
  if (incoming.pathname !== "/video-gateway") return error(404, "Not found");
  let claims, providerUrl;
  try {
    claims = await decryptTicket(incoming.searchParams.get("ticket"), env.MARKET_VIDEO_GATEWAY_SECRET);
    if (claims.aud !== incoming.host || !Number.isFinite(claims.exp) || claims.exp * 1000 <= Date.now()) return error(410, "This rental has expired");
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
