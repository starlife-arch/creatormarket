const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

for (const filename of ["creator.html", "studio.html", "verify-age.html", "verify-creator-identity.html"]) {
  test(filename + " inline scripts parse", () => {
    const html = fs.readFileSync(path.join(__dirname, "..", filename), "utf8");
    const scripts = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)];
    assert.ok(scripts.length > 0, "expected at least one script tag");
    for (const match of scripts) {
      if (/\bsrc\s*=/.test(match[1])) continue;
      assert.doesNotThrow(() => new vm.Script(match[2], { filename }), "invalid inline script in " + filename);
    }
  });
}
