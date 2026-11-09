const {
  getAdmin, originAllowed, json, verifySession, readCookie
} = require("./_market-auth");
const { isMarketAccountEligible } = require("./_market-data");

exports.handler = async (event) => {
  if (event.httpMethod !== "GET") return json(405, { error: "Method not allowed" }, { Allow: "GET" });
  if (!originAllowed(event)) return json(403, { error: "Origin not allowed" });
  try {
    const token = readCookie(event, "dv_market_session");
    const session = verifySession(token);
    if (!session) return json(401, { authenticated: false });

    const admin = getAdmin();
    const userSnap = await admin.firestore().collection("users").doc(session.sub).get();
    if (!userSnap.exists || !isMarketAccountEligible(userSnap.data() || {})) {
      return json(401, { authenticated: false });
    }
    return json(200, { authenticated: true, uid: session.sub });
  } catch (error) {
    console.error("Creator Market session check failed:", error.message);
    return json(500, { authenticated: false, error: "Unable to verify session" });
  }
};
