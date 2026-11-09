const test = require("node:test");
const assert = require("node:assert/strict");

process.env.MARKET_SESSION_SECRET = "test-only-secret-with-more-than-32-characters";
process.env.MARKET_ORIGIN = "https://market.example.test";

const { signSession, verifySession } = require("../netlify/functions/_market-auth");

test("Market session verifies for its configured audience", () => {
  const token = signSession("test-user-123");
  const payload = verifySession(token);
  assert.equal(payload.sub, "test-user-123");
  assert.equal(payload.aud, "https://market.example.test");
});

test("Market session rejects a modified signature", () => {
  const token = signSession("test-user-123");
  const parts = token.split(".");
  parts[2] = (parts[2][0] === "a" ? "b" : "a") + parts[2].slice(1);
  const tampered = parts.join(".");
  assert.equal(verifySession(tampered), null);
});

test("Market session rejects a different audience", () => {
  const token = signSession("test-user-123");
  process.env.MARKET_ORIGIN = "https://other.example.test";
  assert.equal(verifySession(token), null);
});
