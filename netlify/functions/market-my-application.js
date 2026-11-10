const { json } = require("./_market-auth");
const { loadMarketUser } = require("./_market-data");

exports.handler = async event => {
  if (event.httpMethod !== "GET") return json(405, { error: "Method not allowed" }, { Allow: "GET" });
  try {
    const context = await loadMarketUser(event);
    if (context.error) return context.error;
    const snap = await context.admin.firestore().collection("marketCreatorApplications").doc(context.uid).get();
    if (!snap.exists) return json(200, { application: null, ageVerified: context.profile.marketAgeVerified === true, identityVerified: context.profile.marketCreatorIdentityVerified === true });
    const d = snap.data();
    return json(200, { application: {
      status: d.status || "pending",
      username: d.username || "",
      displayName: d.displayName || "",
      submittedAt: d.createdAt?.toDate ? d.createdAt.toDate().toISOString() : null,
      reviewNote: d.status === "rejected" ? (d.reviewNote || "") : ""
    }, ageVerified: context.profile.marketAgeVerified === true, identityVerified: context.profile.marketCreatorIdentityVerified === true });
  } catch (error) {
    console.error("Market application lookup failed:", error.message);
    return json(500, { error: "Unable to load your creator application." });
  }
};
