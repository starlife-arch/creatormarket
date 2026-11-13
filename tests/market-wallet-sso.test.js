const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");

test("Market wallet SSO requires a Market session and eligible shared account", () => {
  const source = fs.readFileSync(path.join(root, "netlify/functions/market-wallet-sso-issue.js"), "utf8");
  assert.match(source, /getMarketUser\(event\)/);
  assert.match(source, /isMarketAccountEligible\(userSnap\.data\(\) \|\| \{\}\)/);
  assert.match(source, /creatorMarketWalletSsoCodes/);
  assert.match(source, /createHash\(["']sha256["']\)/);
  assert.match(source, /datevault-wallet/);
  assert.match(source, /2 \* 60 \* 1000/);
});

test("Market wallet button uses the server-issued one-time handoff, not a static unauthenticated link", () => {
  const source = fs.readFileSync(path.join(root, "assets/market-workspace.js"), "utf8");
  assert.match(source, /openMarketWalletTopUp/);
  assert.match(source, /\/api\/market-wallet-sso-issue/);
  assert.match(source, /window\.location\.assign\(result\.redirectUrl\)/);
  assert.doesNotMatch(source, /href=["']https:\/\/elysiandate\.site\/app\/wallet/);
});
