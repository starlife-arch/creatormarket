const {
  originAllowed, json, clearSessionCookie
} = require("./_market-auth");

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") return json(405, { error: "Method not allowed" }, { Allow: "POST" });
  const origin = event.headers?.origin || event.headers?.Origin;
  if (origin !== (process.env.MARKET_ORIGIN || "https://market.elysiandate.site")) return json(403, { error: "Origin not allowed" });
  return json(200, { ok: true }, { "Set-Cookie": clearSessionCookie() });
};
