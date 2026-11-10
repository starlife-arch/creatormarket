const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const { canonicalDiditPayload, verifyDiditSignature } = require("../netlify/functions/_didit");

function signedEvent(body, secret, timestamp = Math.floor(Date.now() / 1000)) {
  const signature = crypto.createHmac("sha256", secret)
    .update(canonicalDiditPayload(body), "utf8").digest("hex");
  return { headers: { "x-timestamp": String(timestamp), "x-signature-v2": signature } };
}

test("canonical Didit payload sorts nested keys and preserves Unicode", () => {
  assert.equal(canonicalDiditPayload({ z: "last", nested: { b: 2, a: "José" }, a: 1 }),
    '{"a":1,"nested":{"a":"José","b":2},"z":"last"}');
});

test("accepts a valid Didit V2 signature", () => {
  const body = { webhook_type: "status.updated", status: "Approved", vendor_data: "uid-1" };
  const event = signedEvent(body, "test-secret");
  assert.equal(verifyDiditSignature(body, event, "test-secret"), true);
});

test("rejects a modified payload", () => {
  const body = { status: "Approved", session_id: "session-1" };
  const event = signedEvent(body, "test-secret");
  assert.equal(verifyDiditSignature({ ...body, status: "Declined" }, event, "test-secret"), false);
});

test("rejects a stale timestamp", () => {
  const now = Math.floor(Date.now() / 1000);
  const body = { status: "Approved" };
  const event = signedEvent(body, "test-secret", now - 301);
  assert.equal(verifyDiditSignature(body, event, "test-secret", now), false);
});

test("rejects missing signature headers", () => {
  assert.equal(verifyDiditSignature({}, { headers: {} }, "test-secret"), false);
});
