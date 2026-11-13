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
    if (!validCredentials(email, password)) return json(400, { error: "Enter a valid email and password." });
    const auth = await firebasePasswordAuth("login", email, password);
    const session = await establishMarketSession(auth.idToken);
    return json(200, { ok: true, redirectTo: "/member" }, { "Set-Cookie": session.cookie });
  } catch (error) {
    return json(error.status || 500, { error: error.message || "Unable to sign in." });
  }
};
