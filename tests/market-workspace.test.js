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
