const { getAdmin, json, parseBody } = require("./_market-auth");
const { verifyDiditSignature } = require("./_didit");

function getHeader(event, name) {
  const headers = event.headers || {};
  const key = Object.keys(headers).find(k => k.toLowerCase() === name.toLowerCase());
  return key ? String(headers[key] || "") : "";
}

function statusLabel(status) {
  return String(status || "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "").slice(0, 48) || "unknown";
}

exports.handler = async event => {
  if (event.httpMethod !== "POST") return json(405, { error: "Method not allowed." }, { Allow: "POST" });
  try {
    const secret = process.env.DIDIT_WEBHOOK_SECRET;
    const workflowId = process.env.DIDIT_WORKFLOW_ID;
    const environment = String(process.env.DIDIT_ENVIRONMENT || "").toLowerCase();
    if (!secret || !workflowId || !["live", "sandbox"].includes(environment)) {
      return json(503, { error: "Didit webhook is not configured." });
    }

    const body = parseBody(event);
    if (!body || typeof body !== "object" || Array.isArray(body)) return json(400, { error: "Invalid webhook payload." });
    if (!verifyDiditSignature(body, event, secret)) return json(401, { error: "Invalid Didit signature." });

    // Test deliveries validate the endpoint but must never change a real member's age status.
    if (getHeader(event, "x-didit-test-webhook").toLowerCase() === "true") return json(200, { ok: true, test: true });
    if (body.webhook_type !== "status.updated") return json(200, { ok: true, ignored: true });
    if (!body.event_id || !body.session_id || !body.status || body.workflow_id !== workflowId ||
        body.environment !== environment ||
        (process.env.DIDIT_APPLICATION_ID && body.application_id !== process.env.DIDIT_APPLICATION_ID)) {
      return json(400, { error: "Webhook does not match the configured Didit application or workflow." });
    }

    const admin = getAdmin(), db = admin.firestore();
    const eventRef = db.collection("marketDiditWebhookEvents").doc(String(body.event_id));
    const sessionRef = db.collection("marketDiditSessions").doc(String(body.session_id));
    const mappingSnap = await sessionRef.get();
    if (!mappingSnap.exists) return json(404, { error: "Didit session is not registered in Creator Market." });
    const mapping = mappingSnap.data() || {};
    if (!mapping.uid || body.vendor_data !== mapping.uid || mapping.workflowId !== workflowId) {
      return json(400, { error: "Didit session ownership could not be verified." });
    }

    const uid = mapping.uid;
    const requestRef = db.collection("marketAgeVerificationRequests").doc(uid);
    const userRef = db.collection("users").doc(uid);
    const receivedAt = Number(body.created_at || body.timestamp || 0);
    const status = String(body.status);
    const approved = status === "Approved";
    const requestStatus = approved ? "approved" :
      status === "Declined" ? "rejected" :
      status === "In Review" ? "pending_review" :
      status === "Abandoned" || status === "Expired" ? "abandoned" :
      "didit_" + statusLabel(status);

    await db.runTransaction(async tx => {
      const eventSnap = await tx.get(eventRef);
      if (eventSnap.exists) return;
      const freshMapping = await tx.get(sessionRef);
      const requestSnap = await tx.get(requestRef);
      const userSnap = await tx.get(userRef);
      if (!freshMapping.exists || freshMapping.data().uid !== uid || !userSnap.exists) {
        throw new Error("DIDIT_SESSION_MAPPING_INVALID");
      }
      const lastAppliedAt = Number(freshMapping.data().lastAppliedCreatedAt || 0);
      tx.create(eventRef, {
        sessionId: body.session_id, uid, status, webhookType: body.webhook_type,
        createdAt: admin.firestore.FieldValue.serverTimestamp()
      });
      // Didit may deliver retries or older events out of order. Record every event,
      // but only let the newest underlying session update change access.
      if (receivedAt >= lastAppliedAt) {
        tx.set(userRef, {
          marketAgeVerified: approved,
          marketAgeVerifiedAt: approved ? admin.firestore.FieldValue.serverTimestamp() : null,
          marketAgeVerifiedBy: null,
          marketAgeVerificationMethod: "didit_v3",
          marketAgeVerificationProvider: "didit",
          marketAgeVerificationStatus: status
        }, { merge: true });
        if (requestSnap.exists) {
          tx.set(requestRef, {
            status: requestStatus, provider: "didit", diditSessionId: body.session_id,
            diditStatus: status, diditUpdatedAt: receivedAt,
            updatedAt: admin.firestore.FieldValue.serverTimestamp()
          }, { merge: true });
        }
        tx.set(sessionRef, { lastAppliedCreatedAt: receivedAt, lastStatus: status,
          updatedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
        tx.create(db.collection("marketAdminAudit").doc(), {
          actorUid: "didit_webhook", action: "market_age_didit_" + statusLabel(status),
          targetUid: uid, reason: "Verified Didit status.updated event.",
          diditEventId: String(body.event_id), diditSessionId: String(body.session_id),
          createdAt: admin.firestore.FieldValue.serverTimestamp()
        });
      }
    });
    return json(200, { ok: true });
  } catch (error) {
    if (error.message === "DIDIT_SESSION_MAPPING_INVALID") return json(404, { error: "Didit session mapping is unavailable." });
    console.error("Market Didit webhook failed:", error.message);
    return json(500, { error: "Unable to process Didit webhook." });
  }
};
