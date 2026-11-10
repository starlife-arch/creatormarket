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

function matchesSignature(body, signature, secret) {
  if (!secret || !/^[a-f0-9]{64}$/i.test(signature)) return false;
  const expected = crypto.createHmac("sha256", secret)
    .update(canonicalDiditPayload(body), "utf8").digest();
  const supplied = Buffer.from(signature, "hex");
  return supplied.length === expected.length && crypto.timingSafeEqual(supplied, expected);
}

function verifyDiditSignature(body, event, currentSecret, previousSecret = "", nowSeconds = Math.floor(Date.now() / 1000)) {
  const timestamp = header(event, "x-timestamp");
  if (!/^\\d+$/.test(timestamp) || Math.abs(nowSeconds - Number(timestamp)) > 300) return false;

  // During the 24-hour rotation window Didit signs the -Previous header with
  // the replaced secret, not the current one. Never test it against the new key.
  const currentSignature = header(event, "x-signature-v2");
  const previousSignature = header(event, "x-signature-v2-previous");
  return matchesSignature(body, currentSignature, currentSecret) ||
    matchesSignature(body, previousSignature, previousSecret);
}

module.exports = { sortKeys, canonicalDiditPayload, verifyDiditSignature };
