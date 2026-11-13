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

test("Creator Studio explains the buyer DOB check separately from creator ID/Didit options",()=>{
 const html=fs.readFileSync(path.join(__dirname,"..","studio.html"),"utf8");
 assert.match(html,/free manual government ID \+ selfie review/i);
 assert.match(html,/Didit verification for 50 tokens/i);
 assert.match(html,/date-of-birth confirmation and separate creator identity verification/i);
 assert.doesNotMatch(html,/Didit currently completes the 18\+ check/i);
});
