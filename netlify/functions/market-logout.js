const {
  originAllowed, json, clearSessionCookie
} = require("./_market-auth");

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") return json(405, { error: "Method not allowed" }, { Allow: "POST" });
  if (!originAllowed(event)) return json(403, { error: "Origin not allowed" });
  return json(200, { ok: true }, { "Set-Cookie": clearSessionCookie() });
};
