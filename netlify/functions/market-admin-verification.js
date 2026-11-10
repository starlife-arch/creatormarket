const { json } = require("./_market-auth");
const { getMarketUser, isAdmin, getAdmin } = require("./_market-data");

exports.handler = async event => {
  if (event.httpMethod !== "POST") return json(405, { error: "Method not allowed." }, { Allow: "POST" });
  try {
    const auth = getMarketUser(event);
    if (auth.error) return auth.error;
    const admin = getAdmin(), db = admin.firestore();
    const snap = await db.collection("users").doc(auth.uid).get();
    if (!snap.exists || !isAdmin(snap.data())) return json(403, { error: "Administrator access required." });
    return json(410, {
      error: "The UID-based verification action has been retired. Review submitted creator ID and selfie evidence in the Creator identity review queue."
    });
  } catch (error) {
    console.error("Retired Market verification endpoint failed:", error.message);
    return json(500, { error: "Unable to process this verification request." });
  }
};
