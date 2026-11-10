const crypto = require("crypto");

function sortKeys(value) {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value && typeof value === "object") {
    return Object.keys(value).sort().reduce((out, key) => {
      out[key] = sortKeys(value[key]);
      return out;
    }, {});
  }
  return value;
}

function canonicalDiditPayload(body) {
  return JSON.stringify(sortKeys(body));
}

function header(event, name) {
  const headers = event.headers || {};
  const key = Object.keys(headers).find(k => k.toLowerCase() === name.toLowerCase());
  return key ? String(headers[key] || "") : "";
}

function verifyDiditSignature(body, event, secret, nowSeconds = Math.floor(Date.now() / 1000)) {
  if (!secret) return false;
  const timestamp = header(event, "x-timestamp");
  const signature = header(event, "x-signature-v2");
  if (!/^\d+$/.test(timestamp) || !/^[a-f0-9]{64}$/i.test(signature)) return false;
  if (Math.abs(nowSeconds - Number(timestamp)) > 300) return false;
  const expected = crypto.createHmac("sha256", secret)
    .update(canonicalDiditPayload(body), "utf8").digest();
  const supplied = Buffer.from(signature, "hex");
  return supplied.length === expected.length && crypto.timingSafeEqual(supplied, expected);
}

module.exports = { sortKeys, canonicalDiditPayload, verifyDiditSignature };
