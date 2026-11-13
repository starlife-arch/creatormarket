const { getAdmin, json, parseBody } = require("./_market-auth");
const { verifyDiditSignature } = require("./_didit");
function getHeader(event,name){const headers=event.headers||{},key=Object.keys(headers).find(k=>k.toLowerCase()===name.toLowerCase());return key?String(headers[key]||""):"";}
function statusLabel(status){return String(status||"").trim().toLowerCase().replace(/[^a-z0-9]+/g,"_").replace(/^_|_$/g,"").slice(0,48)||"unknown";}
exports.handler=async event=>{
 if(event.httpMethod!=="POST")return json(405,{error:"Method not allowed."},{Allow:"POST"});
 try{
  const secret=process.env.DIDIT_WEBHOOK_SECRET,workflowId=process.env.DIDIT_WORKFLOW_ID,environment=String(process.env.DIDIT_ENVIRONMENT||"").toLowerCase(),workflowType=String(process.env.DIDIT_WORKFLOW_TYPE||"").toLowerCase(),minimumAge=String(process.env.DIDIT_MINIMUM_AGE||"");
  if(!secret||!workflowId||!["live","sandbox"].includes(environment)||workflowType!=="adaptive_age_verification"||minimumAge!=="18")return json(503,{error:"Didit webhook is not configured. Check the Market Didit environment variables."});
  const body=parseBody(event);if(!body||typeof body!=="object"||Array.isArray(body))return json(400,{error:"Invalid webhook payload.",code:"INVALID_PAYLOAD"});
  if(!verifyDiditSignature(body,event,secret,process.env.DIDIT_WEBHOOK_SECRET_PREVIOUS||""))return json(401,{error:"Invalid Didit signature.",code:"SIGNATURE_INVALID"});
  if(getHeader(event,"x-didit-test-webhook").toLowerCase()==="true")return json(200,{ok:true,test:true});
  if(body.webhook_type!=="status.updated")return json(200,{ok:true,ignored:true});
  const missing=["event_id","session_id","status","workflow_id","environment"].filter(k=>body[k]===undefined||body[k]===null||String(body[k]).trim()==="");
  if(missing.length)return json(400,{error:"Didit status event is missing required fields.",fields:missing});
  if(body.workflow_id!==workflowId||String(body.environment).toLowerCase()!==environment)return json(400,{error:"Didit workflow or environment mismatch."});
  if(process.env.DIDIT_APPLICATION_ID&&body.application_id!==process.env.DIDIT_APPLICATION_ID)return json(400,{error:"Didit application mismatch."});
  const admin=getAdmin(),db=admin.firestore(),eventRef=db.collection("marketDiditWebhookEvents").doc(String(body.event_id)),sessionRef=db.collection("marketDiditSessions").doc(String(body.session_id)),mappingSnap=await sessionRef.get();
  if(!mappingSnap.exists)return json(404,{error:"Didit session is not registered in Creator Market."});
  const mapping=mappingSnap.data()||{},purpose=mapping.purpose==="creator_identity"?"creator_identity":"buyer_age";
  if(!mapping.uid||body.vendor_data!==mapping.uid||mapping.workflowId!==workflowId)return json(400,{error:"Didit session ownership or workflow mapping mismatch."});
  const uid=mapping.uid,userRef=db.collection("users").doc(uid),requestRef=db.collection(purpose==="creator_identity"?"marketCreatorIdentityRequests":"marketAgeVerificationRequests").doc(uid);
  const receivedAt=Number(body.created_at||body.timestamp||0),status=String(body.status),approved=status==="Approved";
  const requestStatus=approved?"approved":status==="Declined"?"rejected":status==="In Review"?(purpose==="creator_identity"?"didit_in_review":"pending_review"):["Abandoned","Expired","Kyc Expired"].includes(status)?"abandoned":"didit_"+statusLabel(status);
  await db.runTransaction(async tx=>{
   const eventSnap=await tx.get(eventRef);if(eventSnap.exists)return;
   const freshMapping=await tx.get(sessionRef),requestSnap=await tx.get(requestRef),userSnap=await tx.get(userRef);
   if(!freshMapping.exists||freshMapping.data().uid!==uid||!userSnap.exists)throw new Error("DIDIT_SESSION_MAPPING_INVALID");
   const lastAppliedAt=Number(freshMapping.data().lastAppliedCreatedAt||0);
   tx.create(eventRef,{sessionId:body.session_id,uid,status,purpose,webhookType:body.webhook_type,createdAt:admin.firestore.FieldValue.serverTimestamp()});
   if(receivedAt>=lastAppliedAt){
    const userUpdate=purpose==="creator_identity"?{
      marketCreatorIdentityVerified:approved,marketCreatorIdentityVerifiedAt:approved?admin.firestore.FieldValue.serverTimestamp():null,
      marketCreatorIdentityVerifiedBy:null,marketCreatorIdentityVerificationProvider:"didit",marketCreatorIdentityVerificationStatus:status
    }:{
      marketAgeVerified:approved,marketAgeVerifiedAt:approved?admin.firestore.FieldValue.serverTimestamp():null,
      marketAgeVerifiedBy:null,marketAgeVerificationMethod:"didit_v3",marketAgeVerificationProvider:"didit",marketAgeVerificationStatus:status
    };
    tx.set(userRef,userUpdate,{merge:true});
    if(requestSnap.exists)tx.set(requestRef,{status:requestStatus,provider:"didit",diditSessionId:body.session_id,diditStatus:status,diditUpdatedAt:receivedAt,updatedAt:admin.firestore.FieldValue.serverTimestamp()},{merge:true});
    tx.set(sessionRef,{lastAppliedCreatedAt:receivedAt,lastStatus:status,updatedAt:admin.firestore.FieldValue.serverTimestamp()},{merge:true});
    tx.create(db.collection("marketAdminAudit").doc(),{actorUid:"didit_webhook",action:"market_"+purpose+"_didit_"+statusLabel(status),targetUid:uid,reason:"Verified Didit status.updated event.",diditEventId:String(body.event_id),diditSessionId:String(body.session_id),createdAt:admin.firestore.FieldValue.serverTimestamp()});
   }
  });
  return json(200,{ok:true});
 }catch(error){if(error.message==="DIDIT_SESSION_MAPPING_INVALID")return json(404,{error:"Didit session mapping is unavailable."});console.error("Market Didit webhook failed:",error.message);return json(500,{error:"Unable to process Didit webhook."});}
};
