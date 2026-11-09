const crypto = require("crypto");
const admin = require("firebase-admin");

function getAdmin() {
  if (!admin.apps.length) {
    const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
    if (!raw) throw new Error("FIREBASE_SERVICE_ACCOUNT is not configured");
    admin.initializeApp({ credential: admin.credential.cert(JSON.parse(raw)) });
  }
  return admin;
}

function expectedOrigin() {
  return (process.env.MARKET_ORIGIN || "https://market.elysiandate.site").replace(/\/$/, "");
}

function originAllowed(event) {
  const origin = event.headers?.origin || event.headers?.Origin;
  return !origin || origin === expectedOrigin();
}

function json(statusCode, data, headers = {}) {
  return {
    statusCode,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "Pragma": "no-cache",
      "Referrer-Policy": "no-referrer",
      "X-Content-Type-Options": "nosniff",
      ...headers
    },
    body: JSON.stringify(data)
  };
}

function parseBody(event) {
  if (!event.body) return {};
  const raw = event.isBase64Encoded
    ? Buffer.from(event.body, "base64").toString("utf8")
    : event.body;
  return JSON.parse(raw);
}

function sessionSecret() {
  const secret = process.env.MARKET_SESSION_SECRET;
  if (!secret || secret.length < 32) throw new Error("MARKET_SESSION_SECRET must contain at least 32 characters");
  return secret;
}

function signSession(uid) {
  const now = Math.floor(Date.now() / 1000);
  const payload = Buffer.from(JSON.stringify({
    sub: uid,
    aud: expectedOrigin(),
    iat: now,
    exp: now + 60 * 60 * 12,
    jti: crypto.randomBytes(16).toString("hex")
  })).toString("base64url");
  const data = "v1." + payload;
  const signature = crypto.createHmac("sha256", sessionSecret()).update(data).digest("base64url");
  return data + "." + signature;
}

function verifySession(token) {
  if (!token || typeof token !== "string") return null;
  const parts = token.split(".");
  if (parts.length !== 3 || parts[0] !== "v1") return null;
  const data = parts[0] + "." + parts[1];
  const expected = crypto.createHmac("sha256", sessionSecret()).update(data).digest();
  let actual;
  try { actual = Buffer.from(parts[2], "base64url"); } catch (_) { return null; }
  if (actual.length !== expected.length || !crypto.timingSafeEqual(actual, expected)) return null;
  try {
    const payload = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
    const now = Math.floor(Date.now() / 1000);
    if (!payload.sub || payload.aud !== expectedOrigin() || !Number.isFinite(payload.exp) || payload.exp <= now) return null;
    return payload;
  } catch (_) { return null; }
}

function readCookie(event, name) {
  const header = event.headers?.cookie || event.headers?.Cookie || "";
  const entry = header.split(";").map(v => v.trim()).find(v => v.startsWith(name + "="));
  return entry ? decodeURIComponent(entry.slice(name.length + 1)) : "";
}

function sessionCookie(token) {
  return "dv_market_session=" + encodeURIComponent(token) + "; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=43200";
}

function clearSessionCookie() {
  return "dv_market_session=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0";
}

module.exports = {
  getAdmin, expectedOrigin, originAllowed, json, parseBody,
  signSession, verifySession, readCookie, sessionCookie, clearSessionCookie
};
