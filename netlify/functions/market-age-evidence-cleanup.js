const cloudinary = require("cloudinary").v2;
const { getAdmin } = require("./_market-auth");

exports.config = { schedule: "0 3 * * *" };

exports.handler = async () => {
  const admin = getAdmin(), db = admin.firestore();
  cloudinary.config({ secure: true });
  const now = admin.firestore.Timestamp.now();
  const expired = await db.collection("marketAgeVerificationRequests")
    .where("evidenceExpiresAt", "<=", now).limit(100).get();
  let removed = 0;
  for (const doc of expired.docs) {
    const d = doc.data(), evidence = d.evidence || {};
    for (const item of Object.values(evidence)) {
      if (item?.publicId) {
        await cloudinary.uploader.destroy(item.publicId, {
          resource_type: "image", type: "authenticated", invalidate: true
        }).catch(error => console.error("Expired age evidence deletion failed:", error.message));
      }
    }
    await doc.ref.set({
      evidence: {}, evidenceDeletedAt: admin.firestore.FieldValue.serverTimestamp(),
      status: d.status === "pending_review" || d.status === "awaiting_upload" ? "expired" : d.status
    }, { merge: true });
    removed++;
  }
  const staleUploads = await db.collection("marketAgeVerificationUploads")
    .where("expiresAt", "<=", now).limit(200).get();
  for (const doc of staleUploads.docs) {
    const d = doc.data();
    if (d.publicId) await cloudinary.uploader.destroy(d.publicId, {
      resource_type: "image", type: "authenticated", invalidate: true
    }).catch(error => console.error("Stale upload deletion failed:", error.message));
    await doc.ref.delete();
  }
  return { statusCode: 200, body: JSON.stringify({ ok: true, expiredRequests: removed, staleUploads: staleUploads.size }) };
};
