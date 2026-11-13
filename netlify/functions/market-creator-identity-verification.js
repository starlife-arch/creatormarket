const crypto = require("crypto");
const { cloudinary } = require("./_cloudinary");
const { json, parseBody, originAllowed } = require("./_market-auth");
const { loadMarketUser, cleanText } = require("./_market-data");
function cloudinaryConfig(){cloudinary.config({secure:true});const c=cloudinary.config();if(!c.cloud_name||!c.api_key||!c.api_secret){const e=new Error("CLOUDINARY_URL is not configured");e.code="CLOUDINARY_CONFIG";throw e;}return c;}
async function startDidit(context,db,requestRef){
 const apiKey=process.env.DIDIT_API_KEY,workflowId=process.env.DIDIT_WORKFLOW_ID;
 const environment=String(process.env.DIDIT_ENVIRONMENT||"").toLowerCase();
 const workflowType=String(process.env.DIDIT_WORKFLOW_TYPE||"").toLowerCase();
 const minimumAge=String(process.env.DIDIT_MINIMUM_AGE||"");
 if(!apiKey||!workflowId||!["live","sandbox"].includes(environment)||workflowType!=="adaptive_age_verification"||minimumAge!=="18")
  return json(503,{error:"Didit is not configured. You can use free manual creator ID and selfie review instead."});
 const old=await requestRef.get(),oldData=old.exists?old.data()||{}:{};
 if(oldData.provider==="didit"&&oldData.status==="didit_in_progress"&&oldData.verificationUrl)
  return json(200,{requestId:oldData.requestId,status:oldData.status,verificationUrl:oldData.verificationUrl,reused:true,chargedTokens:0});
 if(["awaiting_upload","pending_review"].includes(oldData.status)&&Object.keys(oldData.evidence||{}).length)
  return json(409,{error:"A manual creator identity review is already in progress. Complete it before switching to Didit."});
 const requestId=crypto.randomUUID(),userRef=db.collection("users").doc(context.uid),chargeRef=db.collection("marketCreatorIdentityCharges").doc(requestId),walletTxRef=userRef.collection("walletTransactions").doc(),FieldValue=context.admin.firestore.FieldValue;
 try{
  await db.runTransaction(async tx=>{
   const [userSnap,chargeSnap,requestSnap]=await Promise.all([tx.get(userRef),tx.get(chargeRef),tx.get(requestRef)]);
   if(!userSnap.exists)throw new Error("ACCOUNT_UNAVAILABLE");
   if(chargeSnap.exists)throw new Error("CHARGE_EXISTS");
   const profile=userSnap.data()||{};
   if(profile.banned||profile.suspended||profile.accountSuspended||profile.marketBanned||profile.walletFrozen)throw new Error("WALLET_HOLD");
   const current=requestSnap.exists?requestSnap.data()||{}:{};
   if(current.provider==="didit"&&current.status==="didit_in_progress")throw new Error("DIDIT_IN_PROGRESS");
   if(["awaiting_upload","pending_review"].includes(current.status)&&Object.keys(current.evidence||{}).length)throw new Error("MANUAL_REVIEW_ACTIVE");
   const balance=Math.floor(Number(profile.walletBalance||0));if(balance<50)throw new Error("INSUFFICIENT_TOKENS");
   tx.update(userRef,{walletBalance:balance-50});
   tx.create(chargeRef,{uid:context.uid,requestId,amountTokens:50,status:"charged",provider:"didit_creator_identity",createdAt:FieldValue.serverTimestamp()});
   tx.create(walletTxRef,{type:"market_creator_identity_didit",amount:-50,note:"Creator identity verification (Didit)",status:"completed",referenceId:requestId,createdAt:FieldValue.serverTimestamp()});
   tx.set(requestRef,{uid:context.uid,requestId,provider:"didit",status:"didit_starting",diditChargeId:requestId,diditChargeTokens:50,evidence:{},createdAt:FieldValue.serverTimestamp(),updatedAt:FieldValue.serverTimestamp()});
  });
 }catch(e){
  if(e.message==="INSUFFICIENT_TOKENS")return json(402,{error:"Didit creator identity verification costs 50 tokens. Top up your shared wallet or choose free manual ID and selfie review."});
  if(e.message==="WALLET_HOLD")return json(403,{error:"Your shared wallet is currently restricted."});
  if(e.message==="MANUAL_REVIEW_ACTIVE")return json(409,{error:"A manual creator identity review is already in progress."});
  if(e.message==="DIDIT_IN_PROGRESS")return json(409,{error:"Your Didit creator verification is already starting. Refresh this page."});
  throw e;
 }
 const refund=async reason=>db.runTransaction(async tx=>{
  const [charge,user]=await Promise.all([tx.get(chargeRef),tx.get(userRef)]);
  if(!charge.exists||charge.data().status!=="charged"||!user.exists)return;
  tx.update(userRef,{walletBalance:Math.floor(Number(user.data().walletBalance||0))+50});
  tx.update(chargeRef,{status:"refunded",refundReason:reason,refundedAt:FieldValue.serverTimestamp()});
  tx.create(userRef.collection("walletTransactions").doc(),{type:"market_creator_identity_didit_refund",amount:50,note:"Refund: Didit creator verification could not be started",status:"completed",referenceId:requestId,createdAt:FieldValue.serverTimestamp()});
  tx.set(requestRef,{status:"abandoned",diditStartFailure:reason,updatedAt:FieldValue.serverTimestamp()},{merge:true});
 });
 let response,result;
 try{response=await fetch("https://verification.didit.me/v3/session/",{method:"POST",headers:{"x-api-key":apiKey,"Content-Type":"application/json"},body:JSON.stringify({workflow_id:workflowId,vendor_data:context.uid,metadata:{market_request_id:requestId,source:"creator_market_identity_verification"},language:"en"}),signal:AbortSignal.timeout(15000)});result=await response.json().catch(()=>({}));}
 catch(e){await refund("provider_network_error");return json(502,{error:"Didit could not be reached. Your 50 tokens have been refunded. Try again or choose free manual review."});}
 if(!response.ok){await refund("provider_rejected_request");return json(502,{error:"Didit could not start. Your 50 tokens have been refunded. Try again or choose free manual review."});}
 let url;try{url=new URL(result.url);if(url.protocol!=="https:"||url.hostname!=="verify.didit.me"||!result.session_id)throw Error("invalid");}
 catch(e){await refund("invalid_provider_response");return json(502,{error:"Didit returned an invalid link. Your 50 tokens have been refunded."});}
 const sessionId=String(result.session_id);
 await db.collection("marketDiditSessions").doc(sessionId).set({uid:context.uid,requestId,workflowId,environment,purpose:"creator_identity",createdAt:FieldValue.serverTimestamp(),lastAppliedCreatedAt:0});
 await requestRef.set({uid:context.uid,requestId,provider:"didit",status:"didit_in_progress",diditSessionId:sessionId,verificationUrl:url.toString(),diditChargeId:requestId,diditChargeTokens:50,updatedAt:FieldValue.serverTimestamp()},{merge:true});
 return json(200,{requestId,status:"didit_in_progress",verificationUrl:url.toString(),chargedTokens:50});
}
exports.handler=async event=>{
 if(!["GET","POST"].includes(event.httpMethod))return json(405,{error:"Method not allowed."},{Allow:"GET, POST"});
 try{
  if(event.httpMethod==="POST"&&!originAllowed(event))return json(403,{error:"Request origin is not allowed."});
  const context=await loadMarketUser(event);if(context.error)return context.error;
  const db=context.admin.firestore(),requestRef=db.collection("marketCreatorIdentityRequests").doc(context.uid),applicationRef=db.collection("marketCreatorApplications").doc(context.uid);
  const application=await applicationRef.get();if(!application.exists||application.data().status==="rejected")return json(403,{error:"Submit a creator application before requesting creator identity verification."});
  if(context.profile.marketCreatorIdentityVerified===true)return json(200,{verified:true,status:"verified",message:"Your creator identity verification is complete."});
  if(event.httpMethod==="GET"){
   const snap=await requestRef.get();if(!snap.exists)return json(200,{verified:false,status:"not_started",message:"Choose free manual ID and selfie review or automatic Didit verification for 50 tokens."});
   const d=snap.data()||{};
   return json(200,{verified:false,status:d.status||"awaiting_upload",provider:d.provider||"manual",verificationUrl:d.verificationUrl||null,
    message:d.status==="pending_review"?"Your creator identity evidence is awaiting admin review.":d.status==="didit_starting"?"Your Didit creator verification is starting. Refresh shortly.":d.status==="didit_in_progress"?"Continue your secure Didit creator identity check.":d.status==="rejected"?(d.reviewNote||"Your creator identity check was not approved. You may submit new evidence or retry Didit."):"Upload your government identity document and a recent selfie for free manual creator identity review."});
  }
  const body=parseBody(event),action=cleanText(body.action,32)||"start";
  if(action==="didit-session")return await startDidit(context,db,requestRef);
  if(action==="start"){
   const old=await requestRef.get();if(old.exists&&["awaiting_upload","pending_review"].includes(old.data().status))return json(200,{requestId:old.data().requestId,status:old.data().status,reused:true});
   const requestId=crypto.randomUUID();await requestRef.set({uid:context.uid,requestId,status:"awaiting_upload",provider:"manual",evidence:{},createdAt:context.admin.firestore.FieldValue.serverTimestamp(),updatedAt:context.admin.firestore.FieldValue.serverTimestamp(),evidenceExpiresAt:context.admin.firestore.Timestamp.fromMillis(Date.now()+7*24*60*60*1000)});
   return json(200,{requestId,status:"awaiting_upload"});
  }
  if(action==="upload-intent"){
   const slot=cleanText(body.slot,24),contentType=cleanText(body.contentType,40).toLowerCase(),sizeBytes=Math.floor(Number(body.sizeBytes));
   if(!["identity_document","selfie"].includes(slot)||!["image/jpeg","image/png","image/webp"].includes(contentType)||!Number.isSafeInteger(sizeBytes)||sizeBytes<1||sizeBytes>8*1024*1024)return json(400,{error:"Upload a JPG, PNG or WebP image no larger than 8 MB."});
   const request=await requestRef.get();if(!request.exists||request.data().status!=="awaiting_upload"||request.data().provider==="didit")return json(409,{error:"Start or resume a free manual creator identity request first."});
   const c=cloudinaryConfig(),uploadId=crypto.randomUUID(),publicId="creator-market-identity/"+context.uid+"/"+request.data().requestId+"/"+slot+"-"+uploadId,timestamp=Math.floor(Date.now()/1000),signedParams={public_id:publicId,timestamp,type:"authenticated",overwrite:false},signature=cloudinary.utils.api_sign_request(signedParams,c.api_secret);
   await db.collection("marketCreatorIdentityUploads").doc(uploadId).create({uid:context.uid,requestId:request.data().requestId,slot,publicId,contentType,sizeBytes,expiresAt:context.admin.firestore.Timestamp.fromMillis(Date.now()+10*60*1000),createdAt:context.admin.firestore.FieldValue.serverTimestamp()});
   return json(200,{uploadId,uploadUrl:"https://api.cloudinary.com/v1_1/"+encodeURIComponent(c.cloud_name)+"/image/upload",uploadParams:{...signedParams,api_key:c.api_key,signature},expiresInSeconds:600});
  }
  if(action==="complete-upload"){
   const uploadId=cleanText(body.uploadId,64);if(!uploadId)return json(400,{error:"Upload reference is required."});
   const uploadRef=db.collection("marketCreatorIdentityUploads").doc(uploadId),uploadSnap=await uploadRef.get();if(!uploadSnap.exists)return json(404,{error:"Upload request not found."});
   const upload=uploadSnap.data();if(upload.uid!==context.uid||!upload.expiresAt?.toDate||upload.expiresAt.toDate().getTime()<Date.now())return json(403,{error:"This upload request is invalid or expired."});
   cloudinaryConfig();const asset=await cloudinary.api.resource(upload.publicId,{resource_type:"image",type:"authenticated"});
   if(asset.public_id!==upload.publicId||asset.type!=="authenticated"||!["jpg","jpeg","png","webp"].includes(String(asset.format).toLowerCase())||!Number.isSafeInteger(Number(asset.bytes))||Number(asset.bytes)>8*1024*1024)return json(400,{error:"The uploaded file did not pass the private evidence checks."});
   await db.runTransaction(async tx=>{const fresh=await tx.get(requestRef);if(!fresh.exists||fresh.data().requestId!==upload.requestId||fresh.data().status!=="awaiting_upload"||fresh.data().provider==="didit")throw new Error("IDENTITY_REQUEST_NOT_ACTIVE");tx.set(requestRef,{evidence:{...(fresh.data().evidence||{}),[upload.slot]:{publicId:upload.publicId,format:asset.format,bytes:asset.bytes}},updatedAt:context.admin.firestore.FieldValue.serverTimestamp()},{merge:true});tx.delete(uploadRef);});
   const updated=await requestRef.get(),evidence=updated.data().evidence||{},complete=Boolean(evidence.identity_document&&evidence.selfie);
   if(complete)await requestRef.update({status:"pending_review",submittedAt:context.admin.firestore.FieldValue.serverTimestamp(),updatedAt:context.admin.firestore.FieldValue.serverTimestamp()});
   return json(200,{ok:true,complete,status:complete?"pending_review":"awaiting_upload",message:complete?"Both files were received privately. Your creator identity request is awaiting admin review.":"File received securely. Upload the remaining file."});
  }
  return json(400,{error:"Unsupported creator identity action."});
 }catch(error){
  if(error.code==="CLOUDINARY_CONFIG")return json(503,{error:"Secure evidence storage is not configured yet."});
  if(error.message==="IDENTITY_REQUEST_NOT_ACTIVE")return json(409,{error:"This identity request is no longer active."});
  console.error("Market creator identity verification failed:",error.message);
  return json(500,{error:"Unable to process creator identity verification."});
 }
};
