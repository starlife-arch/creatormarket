// Loads the Cloudinary library only when it is first used.
//
// The library reads CLOUDINARY_URL the moment it is required, and throws if the
// value is wrong. When it was required at the top of a function file, one bad
// setting crashed the whole function before any of our code ran, and visitors
// saw a bare 502. Loading it lazily lets each function return a clear 503 instead,
// and lets the parts that do not need Cloudinary keep working.
let cached;

function load() {
  if (cached) return cached;
  try {
    cached = require("cloudinary").v2;
  } catch (error) {
    console.error("Cloudinary could not be loaded. Check the CLOUDINARY_URL setting:", error.message);
    const failure = new Error("CLOUDINARY_URL is not configured");
    failure.code = "CLOUDINARY_CONFIG";
    throw failure;
  }
  return cached;
}

// Behaves like require("cloudinary").v2, but loads on first use.
const cloudinary = new Proxy({}, {
  get(_target, property) {
    const lib = load();
    const value = lib[property];
    return typeof value === "function" ? value.bind(lib) : value;
  }
});

module.exports = { cloudinary };
