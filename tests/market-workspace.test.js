const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.join(__dirname, "..");
test("shared workspace script parses", () => {
  const source = fs.readFileSync(path.join(root, "assets/market-workspace.js"), "utf8");
  assert.doesNotThrow(() => new vm.Script(source, { filename: "market-workspace.js" }));
});
test("shared fintech workspace styles include desktop and mobile layouts", () => {
  const css = fs.readFileSync(path.join(root, "assets/market-workspace.css"), "utf8");
  assert.match(css, /\.market-sidebar/);
  assert.match(css, /@media\(max-width:720px\)/);
  assert.match(css, /\.market-shell\.menu-open/);
});
test("workspace pages load shared navigation assets", () => {
  for (const filename of ["index.html", "member.html", "creator.html", "studio.html", "admin.html"]) {
    const html = fs.readFileSync(path.join(root, filename), "utf8");
    assert.match(html, /\/assets\/market-workspace\.css/);
    assert.match(html, /\/assets\/market-workspace\.js/);
  }
});
test("extensionless routes are mapped to the existing application entry points", () => {
  const config = fs.readFileSync(path.join(root, "netlify.toml"), "utf8");
  for (const route of ["/discover", "/search", "/library", "/saved", "/wallet", "/transactions", "/profile", "/studio/*", "/admin/*"]) {
    assert.ok(config.includes('from = "' + route + '"'), "missing route " + route);
  }
});
test("creator reporting uses an inline form rather than browser prompts", () => {
  const html = fs.readFileSync(path.join(root, "creator.html"), "utf8");
  assert.match(html, /marketReportReason/);
  assert.doesNotMatch(html, /\b(prompt|confirm|alert)\s*\(/);
});


test("buyer saved, wallet and transaction routes are backed by dedicated workspace APIs", () => {
  const workspace = fs.readFileSync(path.join(root, "assets/market-workspace.js"), "utf8");
  const saved = fs.readFileSync(path.join(root, "netlify/functions/market-saved.js"), "utf8");
  const data = fs.readFileSync(path.join(root, "netlify/functions/market-workspace-data.js"), "utf8");
  assert.match(workspace, /renderBuyerWorkspace/);
  assert.match(workspace, /\/api\/market-saved/);
  assert.match(workspace, /\/api\/market-workspace-data\?view=buyer/);
  assert.match(saved, /collection\("marketSaved"\)/);
  assert.match(data, /walletTransactions/);
});

test("creator performance, sales, withdrawals and profile settings use creator-owned data", () => {
  const workspace = fs.readFileSync(path.join(root, "assets/market-workspace.js"), "utf8");
  const data = fs.readFileSync(path.join(root, "netlify/functions/market-workspace-data.js"), "utf8");
  const settings = fs.readFileSync(path.join(root, "netlify/functions/market-creator-settings.js"), "utf8");
  assert.match(workspace, /renderCreatorWorkspace/);
  assert.match(workspace, /view==="performance"/);
  assert.match(workspace, /view==="sales"/);
  assert.match(data, /marketCreatorLedger/);
  assert.match(data, /marketPurchases/);
  assert.match(settings, /marketCreatorIdentityVerified/);
});

test("admin audit, settings and private content review are administrator protected", () => {
  const workspace = fs.readFileSync(path.join(root, "assets/market-workspace.js"), "utf8");
  const data = fs.readFileSync(path.join(root, "netlify/functions/market-workspace-data.js"), "utf8");
  const content = fs.readFileSync(path.join(root, "netlify/functions/market-admin-content.js"), "utf8");
  const playback = fs.readFileSync(path.join(root, "netlify/functions/market-video-playback.js"), "utf8");
  const validate = fs.readFileSync(path.join(root, "netlify/functions/market-video-validate.js"), "utf8");
  const gateway = fs.readFileSync(path.join(root, "cloudflare/market-video-gateway/src/index.js"), "utf8");
  assert.match(workspace, /renderAdminWorkspace/);
  assert.match(data, /adminContext\(event\)/);
  assert.match(data, /marketAdminAudit/);
  assert.match(content, /isAdmin\(adminSnap\.data\(\)\)/);
  assert.match(playback, /scope: reviewOnly \? "admin_review"/);
  assert.match(validate, /scope === "admin_review"/);
  assert.match(gateway, /"admin_review"/);
});

test("admin settings are enforced when new creator applications or listings are paused", () => {
  const applications = fs.readFileSync(path.join(root, "netlify/functions/market-creator-application.js"), "utf8");
  const listings = fs.readFileSync(path.join(root, "netlify/functions/market-listings.js"), "utf8");
  assert.match(applications, /creatorApplicationsEnabled === false/);
  assert.match(listings, /newListingsEnabled === false/);
});

test("discovery and creator profiles expose save actions for creators and listings", () => {
  const discover = fs.readFileSync(path.join(root, "index.html"), "utf8");
  const creator = fs.readFileSync(path.join(root, "creator.html"), "utf8");
  assert.match(discover, /data-save-type="creator"/);
  assert.match(creator, /data-save-type="creator"/);
  assert.match(creator, /data-save-type="listing"/);
});


test("wallet purchase debits are displayed as outgoing and platform announcements are surfaced", () => {
  const data = fs.readFileSync(path.join(root, "netlify/functions/market-workspace-data.js"), "utf8");
  const discover = fs.readFileSync(path.join(root, "index.html"), "utf8");
  assert.match(data, /t\.type === "market_purchase" \? -Math\.abs\(rawAmount\) : rawAmount/);
  assert.match(data, /view === "public-settings"/);
  assert.match(discover, /market-workspace-data\?view=public-settings/);
});

test("admin rejection and hiding cannot be bypassed by creator republishing", () => {
  const adminContent = fs.readFileSync(path.join(root, "netlify/functions/market-admin-content.js"), "utf8");
  const creatorListings = fs.readFileSync(path.join(root, "netlify/functions/market-listings.js"), "utf8");
  assert.match(adminContent, /moderationLocked: action === "reject" \|\| action === "hide" \? true : false/);
  assert.match(creatorListings, /data\.moderationLocked === true/);
});


test("buyer transaction history is cursor-paginated rather than capped to one short list", () => {
  const data = fs.readFileSync(path.join(root, "netlify/functions/market-workspace-data.js"), "utf8");
  const workspace = fs.readFileSync(path.join(root, "assets/market-workspace.js"), "utf8");
  assert.match(data, /orderBy\("createdAt", "desc"\)\.limit\(50\)/);
  assert.match(data, /nextCursor: txSnap\.docs\.length === 50/);
  assert.match(workspace, /marketLoadMore/);
  assert.match(workspace, /view=buyer&cursor=/);
});


test("admin earnings reports are computed from the platform ledger and preserve the 85/15 split", () => {
  const data = fs.readFileSync(path.join(root, "netlify/functions/market-workspace-data.js"), "utf8");
  const workspace = fs.readFileSync(path.join(root, "assets/market-workspace.js"), "utf8");
  assert.match(data, /collection\("marketPlatformLedger"\)/);
  assert.match(data, /platformFeeTokens: entries\.reduce/);
  assert.match(workspace, /view=admin-earnings/);
  assert.match(workspace, /Creator earnings · 85%/);
  assert.match(workspace, /Platform commission · 15%/);
});
