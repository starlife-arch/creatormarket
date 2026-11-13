const { json, parseBody, originAllowed } = require("./_market-auth");
const { validCredentials, firebasePasswordAuth, establishMarketSession } = require("./_market-firebase-auth");

exports.handler = async event => {
  if (event.httpMethod === "OPTIONS") return { statusCode: 204, headers: { "Cache-Control": "no-store" }, body: "" };
  if (event.httpMethod !== "POST") return json(405, { error: "Method not allowed" }, { Allow: "POST, OPTIONS" });
  if (!originAllowed(event)) return json(403, { error: "Origin not allowed" });
  try {
    const body = parseBody(event);
    const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
    const password = body.password;
    const displayName = typeof body.displayName === "string" ? body.displayName.trim().replace(/\s+/g, " ").slice(0, 80) : "";
    if (!displayName || !validCredentials(email, password)) {
      return json(400, { error: "Enter your name, a valid email, and a password of at least 8 characters." });
    }
    const auth = await firebasePasswordAuth("register", email, password);
    const session = await establishMarketSession(auth.idToken, displayName);
    return json(201, { ok: true, redirectTo: "/member", message: "Your Creator Market account is ready." }, { "Set-Cookie": session.cookie });
  } catch (error) {
    return json(error.status || 500, { error: error.message || "Unable to create your account." });
  }
};
