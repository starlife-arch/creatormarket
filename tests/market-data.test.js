const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

process.env.MARKET_SESSION_SECRET = "test-only-secret-with-more-than-32-characters";
process.env.MARKET_ORIGIN = "https://market.example.test";

const { cleanText, validUsername, isAdmin, isMarketAccountEligible } = require("../netlify/functions/_market-data");

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

const { expiryFor } = require("../netlify/functions/market-purchase");

test("timed access expires using server milliseconds", () => {
  const start = Date.UTC(2026, 0, 1, 12, 0, 0);
  assert.equal(expiryFor({ type: "timed", unit: "hour", value: 6 }, start).getTime(), start + 6 * 60 * 60 * 1000);
});

test("week rentals use seven-day durations", () => {
  const start = Date.UTC(2026, 0, 1);
  assert.equal(expiryFor({ type: "rental", unit: "week", value: 2 }, start).getTime(), start + 14 * 24 * 60 * 60 * 1000);
});

test("month rentals clamp month-end dates instead of overflowing", () => {
  const start = Date.UTC(2026, 0, 31, 10, 0, 0);
  assert.equal(expiryFor({ type: "rental", unit: "month", value: 1 }, start).toISOString(), "2026-02-28T10:00:00.000Z");
});

test("permanent access has no expiry", () => {
  assert.equal(expiryFor({ type: "permanent" }, Date.now()), null);
});


test("Market access is independent of every DateVault membership state", () => {
  for (const status of ["trial", "standard", "elite", "vault", "active_member", "expired", "cancelled", "rejected", "pending_admin_review", undefined]) {
    assert.equal(isMarketAccountEligible({ status }), true, String(status));
  }
});

test("only explicit platform safety restrictions block Market access", () => {
  for (const field of ["banned", "suspended", "accountSuspended", "marketBanned"]) {
    assert.equal(isMarketAccountEligible({ [field]: true }), false, field);
    assert.equal(isMarketAccountEligible({ [field]: false }), true, field);
  }
});

test("DateVault membership is never treated as Market age verification", () => {
  const source = fs.readFileSync(path.join(__dirname, "../netlify/functions/_market-data.js"), "utf8");
  assert.equal(source.includes('profile.status === "active_member"'), false);
  assert.equal(source.includes("ageVerificationRequired: !isAdmin(profile)"), true);
});

test("Market age verification only accepts an explicit Market approval", () => {
  const source = fs.readFileSync(path.join(__dirname, "../netlify/functions/market-age-verification.js"), "utf8");
  assert.equal(source.includes("context.profile.marketAgeVerified === true"), true);
  assert.equal(source.includes("dateVaultApproved"), false);
});

test("DateVault age attestation cannot grant Market age approval from membership status", () => {
  const source = fs.readFileSync(path.join(__dirname, "../netlify/functions/market-age-attest.js"), "utf8");
  assert.equal(source.includes("Complete Creator Market's age-assurance process"), true);
  assert.equal(source.includes('profile.status !== "active_member"'), false);
});

test("Market mobile drawer has explicit accessible open and close behavior", () => {
  const workspace = fs.readFileSync(path.join(__dirname, "../assets/market-workspace.js"), "utf8");
  const css = fs.readFileSync(path.join(__dirname, "../assets/market-workspace.css"), "utf8");
  assert.match(workspace, /aria-expanded/);
  assert.ok(workspace.includes('aside.querySelectorAll("a.market-nav-link")'));
  assert.match(workspace, /event\.key==="Escape"/);
  assert.match(css, /\.market-shell\.menu-open \.market-sidebar/);
  assert.match(css, /\.market-sidebar nav\{display:block/);
});


