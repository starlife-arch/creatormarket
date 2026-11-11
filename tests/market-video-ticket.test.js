const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");

process.env.MARKET_VIDEO_GATEWAY_SECRET = "unit-test-secret-with-at-least-thirty-two-characters";
const { issueVideoTicket, base64url } = require("../netlify/functions/_market-video-ticket");

test("gateway tickets encrypt claims and can be decrypted only with the configured secret", () => {
  const claims = { aud: "market.example.test", listingId: "listing-1", videoId: "video-1", expMs: 2000000000000 };
  const ticket = issueVideoTicket(claims);
  const [ivPart, encryptedPart, tagPart] = ticket.split(".");
  assert.equal(ticket.split(".").length, 3);
  const key = crypto.createHash("sha256").update(process.env.MARKET_VIDEO_GATEWAY_SECRET).digest();
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, Buffer.from(ivPart, "base64url"));
  decipher.setAuthTag(Buffer.from(tagPart, "base64url"));
  const decoded = Buffer.concat([
    decipher.update(Buffer.from(encryptedPart, "base64url")),
    decipher.final()
  ]).toString("utf8");
  assert.deepEqual(JSON.parse(decoded), claims);
});

test("gateway path encoding is URL-safe and round-trips HLS query parameters", () => {
  const path = "/vod/video-1/token/private-token/hls/manifest.m3u8?avh=session-token";
  const encoded = base64url(path);
  assert.match(encoded, /^[A-Za-z0-9_-]+$/);
  assert.equal(Buffer.from(encoded, "base64url").toString("utf8"), path);
});
