const { json, parseBody } = require("./_market-auth");
const { loadMarketUser, cleanText, validUsername } = require("./_market-data");

exports.handler = async event => {
  if (event.httpMethod !== "POST") return json(405, { error: "Method not allowed" }, { Allow: "POST" });
  try {
    // Applying is allowed for an eligible Market member. Age and creator identity
    // are checked before publishing/uploading, not before submitting an application.
    const context = await loadMarketUser(event);
    if (context.error) return context.error;
    const body = parseBody(event);
    const username = cleanText(body.username, 30).toLowerCase().replace(/^@/, "");
    const displayName = cleanText(body.displayName, 60);
    const bio = cleanText(body.bio, 500);
    const category = cleanText(body.category, 40);
    if (!validUsername(username)) return json(400, { error: "Username must be 3–30 characters, use letters, numbers or underscores, and cannot start or end with an underscore." });
    if (!displayName) return json(400, { error: "Enter a public display name." });
    if (bio.length < 20) return json(400, { error: "Please write a short creator bio of at least 20 characters." });
    const db = context.admin.firestore(), applicationRef = db.collection("marketCreatorApplications").doc(context.uid);
    const existing = await applicationRef.get();
    if (existing.exists && ["pending", "approved"].includes(existing.data().status)) {
      return json(409, { error: "You already have a pending or approved creator application." });
    }
    const reserved = new Set(["admin","administrator","support","datevault","market","help","official","moderator","system"]);
    if (reserved.has(username)) return json(400, { error: "That username is reserved." });
    const handleRef = db.collection("marketCreatorHandles").doc(username);
    const handle = await handleRef.get();
    if (handle.exists && handle.data().uid !== context.uid) return json(409, { error: "That creator username is already taken." });
    await applicationRef.set({
      uid: context.uid, username, displayName, bio, category: category || "Other",
      status: "pending", createdAt: context.admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: context.admin.firestore.FieldValue.serverTimestamp()
    });
    return json(201, { ok: true, status: "pending",
      message: "Application submitted. Before publishing, complete 18+ verification and creator identity verification; admin approval is also required." });
  } catch (error) {
    console.error("Market creator application failed:", { message:error.message, code:error.code, stack:error.stack });
    return json(500, { error: "Unable to submit your creator application. Please retry shortly." });
  }
};
