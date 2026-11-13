const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

process.env.MARKET_SESSION_SECRET = "test-only-secret-with-more-than-32-characters";
process.env.MARKET_ORIGIN = "https://market.example.test";

const { validCredentials } = require("../netlify/functions/_market-firebase-auth");

test("Market registration validates email and password without requiring dating-profile fields", () => {
  assert.equal(validCredentials("new.user@example.com", "correct-horse-battery"), true);
  assert.equal(validCredentials("not-an-email", "correct-horse-battery"), false);
  assert.equal(validCredentials("new.user@example.com", "short"), false);
  assert.equal(validCredentials("new.user@example.com", "x".repeat(129)), false);
});

test("Market registration and login use the shared Firebase Authentication project", () => {
  const helper = fs.readFileSync(path.join(__dirname, "../netlify/functions/_market-firebase-auth.js"), "utf8");
  assert.match(helper, /identitytoolkit\.googleapis\.com\/v1\/accounts/);
  assert.match(helper, /DATEVAULT_FIREBASE_API_KEY/);
  assert.match(helper, /verifyIdToken\(idToken\)/);
  assert.match(helper, /collection\("users"\)\.doc\(decoded\.uid\)/);
});

test("Market-only registration creates an identity profile without granting dating membership", () => {
  const helper = fs.readFileSync(path.join(__dirname, "../netlify/functions/_market-firebase-auth.js"), "utf8");
  assert.match(helper, /status: "market_only"/);
  assert.match(helper, /stage: "market_only"/);
  assert.match(helper, /plan: "none"/);
  assert.match(helper, /walletBalance: 0/);
  assert.match(helper, /role: "user"/);
  assert.doesNotMatch(helper, /adminApproved: true/);
});

test("Market homepage offers independent registration and age assurance", () => {
  const homepage = fs.readFileSync(path.join(__dirname, "../index.html"), "utf8");
  assert.match(homepage, /href="\/auth\.html"/);
  assert.match(homepage, /href="\/verify-age"/);
  assert.doesNotMatch(homepage, /Confirm I am 18\+/);
  assert.doesNotMatch(homepage, /Sign in to DateVault, then open Creator Market/);
});

test("Market auth screen offers direct registration and existing-account sign in", () => {
  const page = fs.readFileSync(path.join(__dirname, "../auth.html"), "utf8");
  assert.match(page, /Create Market account/);
  assert.match(page, /market-register/);
  assert.match(page, /market-login/);
  assert.match(page, /wallet remains shared/i);
});
