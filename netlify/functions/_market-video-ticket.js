const crypto = require("crypto");

function videoGatewaySecret() {
  const secret = process.env.MARKET_VIDEO_GATEWAY_SECRET || "";
  if (secret.length < 32) throw new Error("MARKET_VIDEO_GATEWAY_SECRET must contain at least 32 characters");
  return secret;
}

function issueVideoTicket(payload, secret = videoGatewaySecret()) {
  const key = crypto.createHash("sha256").update(secret, "utf8").digest();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(JSON.stringify(payload), "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv, encrypted, tag].map(part => part.toString("base64url")).join(".");
}

function base64url(value) {
  return Buffer.from(value, "utf8").toString("base64url");
}

module.exports = { issueVideoTicket, base64url, videoGatewaySecret };
