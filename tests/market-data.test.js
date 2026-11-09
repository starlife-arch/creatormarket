const test = require("node:test");
const assert = require("node:assert/strict");

process.env.MARKET_SESSION_SECRET = "test-only-secret-with-more-than-32-characters";
process.env.MARKET_ORIGIN = "https://market.example.test";

const { cleanText, validUsername, isAdmin } = require("../netlify/functions/_market-data");

test("creator usernames accept safe lowercase handles", () => {
  assert.equal(validUsername("agon_22"), true);
  assert.equal(validUsername("creator2026"), true);
});

test("creator usernames reject short, reserved-shape and unsafe handles", () => {
  assert.equal(validUsername("ab"), false);
  assert.equal(validUsername("_creator"), false);
  assert.equal(validUsername("creator_"), false);
  assert.equal(validUsername("bad.name"), false);
  assert.equal(validUsername("two words"), false);
});

test("text input is trimmed, whitespace-normalized and bounded", () => {
  assert.equal(cleanText("  a   creator\n bio  ", 40), "a creator bio");
  assert.equal(cleanText("abcdef", 3), "abc");
  assert.equal(cleanText(null, 10), "");
});

test("admin authorization accepts only explicit admin markers", () => {
  assert.equal(isAdmin({ role: "admin" }), true);
  assert.equal(isAdmin({ isAdmin: true }), true);
  assert.equal(isAdmin({ role: "member" }), false);
});
